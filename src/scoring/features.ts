import { RawPost } from '../types';

export const CATEGORIES = ['memes', 'animals', 'politics', 'crypto', 'technology', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Canonical, ordered list of feature names shared by extractor + model. */
export const FEATURE_NAMES = [
  'log_followers',
  'log_velocity',
  'likes_per_follower',
  'rt_ratio',
  'quote_ratio',
  'reply_ratio',
  'has_media',
  'is_video',
  'text_len',
  'has_hashtag',
  'has_url',
  'age_hours',
  ...CATEGORIES.map((c) => `cat_${c}`),
] as const;

/** Weighted engagement — the single number we treat as "how big is this". */
export function composite(p: { likes: number; retweets: number; quotes: number; replies: number }): number {
  return p.likes + 2 * p.retweets + 3 * p.quotes + 0.5 * p.replies;
}

export function ageHours(createdAt: Date, now: Date = new Date()): number {
  return Math.max(0.05, (now.getTime() - createdAt.getTime()) / 3.6e6);
}

/** Turn a post + its category into a normalized feature vector. */
export function extractFeatures(p: RawPost, category: string, now: Date = new Date()): Record<string, number> {
  const age = ageHours(p.createdAt, now);
  const comp = composite(p);
  const followers = p.authorFollowers ?? 0;

  const f: Record<string, number> = {
    log_followers: Math.log10(followers + 10),
    log_velocity: Math.log10(comp / age + 1), // engagement per hour — the key "rising" signal
    likes_per_follower: followers > 0 ? p.likes / followers : 0,
    rt_ratio: p.likes > 0 ? p.retweets / p.likes : 0,
    quote_ratio: p.likes > 0 ? p.quotes / p.likes : 0,
    reply_ratio: p.likes > 0 ? p.replies / p.likes : 0,
    has_media: p.mediaType && p.mediaType !== 'none' ? 1 : 0,
    is_video: p.mediaType === 'video' || p.mediaType === 'gif' ? 1 : 0,
    text_len: Math.min(p.text.length, 280) / 280,
    has_hashtag: /#\w/.test(p.text) ? 1 : 0,
    has_url: /https?:\/\//.test(p.text) ? 1 : 0,
    age_hours: Math.min(age, 48) / 48,
  };
  for (const c of CATEGORIES) f[`cat_${c}`] = category === c ? 1 : 0;
  return f;
}
