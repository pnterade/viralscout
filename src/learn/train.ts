import { prisma } from '../db';
import { Model, ModelJSON } from '../scoring/model';
import { log } from '../logger';

/** Load the current trained model, or null if none exists yet. */
export async function loadModel(): Promise<Model | null> {
  const state = await prisma.modelState.findUnique({ where: { id: 1 } });
  if (!state) return null;
  return new Model(JSON.parse(state.json) as ModelJSON);
}

/** Retrain on all graded outcomes and persist the new model. */
export async function train(): Promise<{ samples: number; accuracy: number } | null> {
  const preds = await prisma.prediction.findMany({ where: { outcomeKnown: true } });
  const rows = preds.map((p) => ({
    features: JSON.parse(p.features) as Record<string, number>,
    label: p.wentViral ? 1 : 0,
  }));

  if (rows.length < 10) {
    log.info(`Only ${rows.length} labeled samples — need 10+ before training.`);
    return null;
  }

  const model = Model.train(rows);
  let correct = 0;
  for (const r of rows) if ((model.predict(r.features) >= 0.5 ? 1 : 0) === r.label) correct++;
  const accuracy = correct / rows.length;

  const json = JSON.stringify(model.toJSON());
  await prisma.modelState.upsert({
    where: { id: 1 },
    create: { id: 1, json, samples: rows.length },
    update: { json, samples: rows.length },
  });
  log.info(`Trained on ${rows.length} outcomes — train accuracy ${(accuracy * 100).toFixed(1)}%`);
  return { samples: rows.length, accuracy };
}
