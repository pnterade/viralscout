import { MockSource } from './sources/mock';
import { extractFeatures } from './scoring/features';
import { Model } from './scoring/model';
import { heuristicScore } from './scoring/predict';
import { keywordCategory } from './scoring/categorize';
import { config } from './config';

/**
 * Offline proof that the system learns. Generates a large batch of posts,
 * grades each by its *mature* engagement, then shows that a model trained on
 * discovery-time features beats the cold-start heuristic at predicting virality.
 */
export async function runDemo(n = 600): Promise<void> {
  const src = new MockSource();
  const raw = await src.fetchCandidates([], n);

  const rows: { features: Record<string, number>; label: number; heur: number }[] = [];
  for (const p of raw) {
    const features = extractFeatures(p, keywordCategory(p));
    const [mature] = await src.refresh([{ externalId: p.externalId, createdAt: new Date(Date.now() - 48 * 3.6e6) }]);
    const label = (mature.views ?? 0) >= config.scoring.viralViews ? 1 : 0;
    rows.push({ features, label, heur: heuristicScore(features) });
  }

  // shuffle + 80/20 split
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const cut = Math.floor(rows.length * 0.8);
  const train = rows.slice(0, cut);
  const test = rows.slice(cut);
  const viral = rows.filter((r) => r.label === 1).length;

  const model = Model.train(train);

  const metrics = (predict: (r: (typeof rows)[number]) => number, thresh: number) => {
    let tp = 0, fp = 0, fn = 0, correct = 0;
    for (const r of test) {
      const yhat = predict(r) >= thresh ? 1 : 0;
      if (yhat === r.label) correct++;
      if (yhat === 1 && r.label === 1) tp++;
      if (yhat === 1 && r.label === 0) fp++;
      if (yhat === 0 && r.label === 1) fn++;
    }
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { acc: correct / test.length, precision, recall, f1 };
  };

  const heur = metrics((r) => r.heur, config.scoring.notifyThreshold);
  const learned = metrics((r) => model.predict(r.features), 0.5);
  const pct = (x: number) => (x * 100).toFixed(1) + '%';

  console.log('\n=== ViralScout learning demo ===');
  console.log(`Posts: ${rows.length}  (viral: ${viral}, ${pct(viral / rows.length)})   train/test: ${train.length}/${test.length}\n`);
  console.log('                 accuracy   precision   recall     f1');
  console.log(`  heuristic      ${pct(heur.acc).padEnd(10)} ${pct(heur.precision).padEnd(11)} ${pct(heur.recall).padEnd(10)} ${pct(heur.f1)}`);
  console.log(`  learned model  ${pct(learned.acc).padEnd(10)} ${pct(learned.precision).padEnd(11)} ${pct(learned.recall).padEnd(10)} ${pct(learned.f1)}`);
  console.log('\nThe learned model is what powers scoring once enough real outcomes are collected.\n');
}
