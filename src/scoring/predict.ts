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

/** View threshold for "already viral", per platform (TikTok is much higher than X). */
export function viralViewsFor(platform: string): number {
  return config.scoring.viralViews[platform] ?? config.scoring.viralViews.twitter;
}

/** Lower bound of the "upcoming/rising" view band, per platform. */
export function upcomingMinViewsFor(platform: string): number {
  return config.scoring.upcomingMinViews[platform] ?? config.scoring.upcomingMinViews.twitter;
}

/** Stage is view-based: already-viral vs a smaller "rising" band, else ignore. */
export function classifyStage(p: RawPost, score: number): Stage {
  const views = p.views ?? 0;
  if (views >= viralViewsFor(p.platform)) return 'already_viral';
  if (views >= upcomingMinViewsFor(p.platform) && score >= config.scoring.notifyThreshold) return 'upcoming';
  return 'ignore';
}
