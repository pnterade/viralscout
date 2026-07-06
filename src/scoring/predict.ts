import { config } from '../config';
import { Model } from './model';
import { RawPost } from '../types';

/**
 * Cold-start scorer used before the model has enough labeled outcomes.
 * Hand-tuned: engagement velocity dominates, reach and media help.
 */
export function heuristicScore(f: Record<string, number>): number {
  const z =
    -3 +
    1.4 * f.log_velocity +
    0.5 * f.log_followers +
    0.8 * f.has_media +
    0.6 * f.is_video +
    2.0 * (f.likes_per_follower > 0.02 ? 1 : f.likes_per_follower * 50);
  return 1 / (1 + Math.exp(-z));
}

/** Use the learned model once it has enough samples; otherwise the heuristic. */
export function scoreFeatures(model: Model | null, f: Record<string, number>): number {
  if (model && model.samples >= config.scoring.minTrainSamples) return model.predict(f);
  return heuristicScore(f);
}

export type Stage = 'already_viral' | 'upcoming' | 'ignore';

/** Stage is view-based: already-viral vs a smaller "rising" band, else ignore. */
export function classifyStage(p: RawPost, score: number): Stage {
  const views = p.views ?? 0;
  if (views >= config.scoring.viralViews) return 'already_viral';
  if (views >= config.scoring.upcomingMinViews && score >= config.scoring.notifyThreshold) return 'upcoming';
  return 'ignore';
}
