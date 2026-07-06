import { prisma } from '../db';
import { config } from '../config';
import { Model, ModelJSON } from '../scoring/model';
import { log } from '../logger';

// The taste model lives in ModelState row id=2 (virality model is id=1).
const TASTE_ID = 2;

/** Load the user's taste model, or null if not trained yet. */
export async function loadTasteModel(): Promise<Model | null> {
  const state = await prisma.modelState.findUnique({ where: { id: TASTE_ID } });
  if (!state) return null;
  return new Model(JSON.parse(state.json) as ModelJSON);
}

/** Predicted "you'll like this" probability (neutral 0.5 until enough feedback). */
export function tasteScore(model: Model | null, features: Record<string, number>): number {
  if (!model || model.samples < config.taste.minFeedback) return 0.5;
  return model.predict(features);
}

/** True once the taste model has enough feedback to actively shape what's sent. */
export function tasteActive(model: Model | null): boolean {
  return !!model && model.samples >= config.taste.minFeedback;
}

/**
 * Retrain the taste model on all 👍/👎 feedback. Each post's feature vector comes
 * from its stored prediction; the latest feedback per post wins.
 */
export async function trainTaste(): Promise<{ samples: number; likes: number } | null> {
  const feedback = await prisma.feedback.findMany({
    orderBy: { createdAt: 'asc' },
    include: { post: { include: { prediction: true } } },
  });

  // Latest feedback per post -> { features, label }.
  const byPost = new Map<string, { features: Record<string, number>; label: number }>();
  for (const f of feedback) {
    const feats = f.post?.prediction?.features;
    if (!feats) continue;
    byPost.set(f.postId, {
      features: JSON.parse(feats) as Record<string, number>,
      label: f.label === 'like' ? 1 : 0,
    });
  }

  const rows = [...byPost.values()];
  if (rows.length < 3) {
    return null; // need at least a few to fit anything
  }

  // Stronger regularization here — feedback is sparse, avoid overfitting.
  const model = Model.train(rows, { epochs: 400, lr: 0.1, l2: 0.02 });
  const json = JSON.stringify(model.toJSON());
  await prisma.modelState.upsert({
    where: { id: TASTE_ID },
    create: { id: TASTE_ID, json, samples: rows.length },
    update: { json, samples: rows.length },
  });

  const likes = rows.filter((r) => r.label === 1).length;
  log.info(`Taste model retrained on ${rows.length} ratings (${likes} 👍 / ${rows.length - likes} 👎).`);
  return { samples: rows.length, likes };
}

/** Print what the bot has learned about your taste (per-category 👍/👎 + status). */
export async function tasteReport(): Promise<void> {
  const feedback = await prisma.feedback.findMany({ include: { post: true } });
  if (!feedback.length) {
    console.log('\nNo ratings yet. Tap 👍/👎 on the alerts and your taste profile appears here.\n');
    return;
  }
  const byCat: Record<string, { like: number; dislike: number }> = {};
  for (const f of feedback) {
    const c = f.post?.category ?? 'other';
    byCat[c] ??= { like: 0, dislike: 0 };
    if (f.label === 'like') byCat[c].like++;
    else byCat[c].dislike++;
  }

  const model = await loadTasteModel();
  const active = tasteActive(model);
  console.log(`\n=== Your taste profile (${feedback.length} ratings) ===`);
  console.log(`Model status: ${active ? 'ACTIVE — shaping your feed' : `learning (need ${config.taste.minFeedback}+ ratings to activate)`}\n`);
  console.log('  category      👍   👎   lean');
  for (const [cat, v] of Object.entries(byCat).sort((a, b) => b[1].like - a[1].like)) {
    const total = v.like + v.dislike;
    const pct = total ? Math.round((v.like / total) * 100) : 0;
    const bar = pct >= 60 ? '👍 like' : pct <= 40 ? '👎 avoid' : 'neutral';
    console.log(`  ${cat.padEnd(12)} ${String(v.like).padStart(3)}  ${String(v.dislike).padStart(3)}   ${bar}`);
  }
  console.log('');
}
