import { RawPost, Source, PostRef } from '../types';

/**
 * Deterministic fake data source. Engagement is a pure function of the post's
 * id (seed + "viral potential") and its age, so re-fetching later shows the
 * post *growing* — which lets the whole learn-from-outcomes loop work offline.
 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const unit = (s: string) => hash(s) / 4294967295;

const SAMPLE_TEXT: Record<string, string[]> = {
  memes: ['nobody: — me at 3am:', "POV: it's Monday again", 'this is unnecessarily accurate 💀', 'the way I gasped 😂'],
  animals: ['this golden retriever just made my whole week 🐶', 'cat knocked it off the table on purpose', 'baby elephant sneezes and scares itself'],
  politics: ['BREAKING: new bill passes the senate tonight', 'the debate stage just got heated', 'poll numbers are shifting fast'],
  crypto: ['SOL just broke a new range, eyes on the next leg', 'this new token is doing crazy volume 👀', 'bitcoin quietly reclaiming levels'],
  technology: ['this new AI model is genuinely unreal', 'the new iPhone leak looks wild', 'openai just shipped something big'],
};
const CATS = ['memes', 'animals', 'politics', 'crypto', 'technology'];

/** Engagement counts for a post of a given seed/potential at a given age. */
function engagementAt(seed: number, potential: number, ageH: number) {
  const peak = Math.floor(50 + Math.pow(potential, 3) * 400000); // few big winners, many small
  const tau = 2 + (1 - potential) * 20; // high-potential posts grow faster
  const frac = 1 - Math.exp(-ageH / tau);
  const likes = Math.max(1, Math.floor(peak * frac * (0.7 + 0.6 * seed)));
  return {
    likes,
    retweets: Math.floor(likes * (0.15 + 0.2 * seed)),
    quotes: Math.floor(likes * 0.04),
    replies: Math.floor(likes * (0.08 + 0.1 * seed)),
    views: likes * (20 + Math.floor(40 * seed)),
  };
}

export class MockSource implements Source {
  name: string;
  platform: string;
  private viewMult: number;

  constructor(platform = 'twitter') {
    this.platform = platform;
    this.name = platform === 'twitter' ? 'mock' : `mock-${platform}`;
    this.viewMult = platform === 'tiktok' ? 12 : 1; // TikTok play counts run far higher than X views
  }

  private engagement(seed: number, potential: number, ageH: number) {
    const e = engagementAt(seed, potential, ageH);
    return { ...e, views: e.views * this.viewMult };
  }

  private make(cat: string, index: number, now: Date): RawPost {
    const id = `mock-${this.platform}-${cat}-${index}`;
    const seed = unit(id);
    const potential = unit(id + 'p');
    const ageH = 0.16 + unit(id + 'a') * 8; // 10 min .. 8 h old
    const createdAt = new Date(now.getTime() - ageH * 3.6e6);
    const followers = Math.floor(500 + Math.pow(unit(id + 'f'), 2) * 3_000_000);
    const isTikTok = this.platform === 'tiktok';
    const mediaType = isTikTok ? 'video' : ['none', 'photo', 'video', 'gif'][Math.floor(unit(id + 'm') * 4)];
    const handle = `${cat}_acct_${index % 50}`;
    const texts = SAMPLE_TEXT[cat];
    const text = texts[Math.floor(unit(id + 't') * texts.length)];
    return {
      platform: this.platform,
      externalId: id,
      authorHandle: handle,
      authorName: `${cat} poster`,
      authorFollowers: followers,
      text,
      url: isTikTok
        ? `https://www.tiktok.com/@${handle}/video/${hash(id)}`
        : `https://twitter.com/i/status/${hash(id)}`,
      mediaType,
      createdAt,
      ...this.engagement(seed, potential, ageH),
    };
  }

  async fetchCandidates(_queries: string[], limit: number): Promise<RawPost[]> {
    const now = new Date();
    const bucket = Math.floor(now.getTime() / 3.6e6); // fresh set each hour
    const out: RawPost[] = [];
    for (let i = 0; out.length < limit; i++) {
      const cat = CATS[i % CATS.length];
      out.push(this.make(cat, bucket * 1000 + Math.floor(i / CATS.length), now));
    }
    return out.slice(0, limit);
  }

  async refresh(refs: PostRef[]): Promise<RawPost[]> {
    const now = new Date();
    return refs.map((r) => {
      const seed = unit(r.externalId);
      const potential = unit(r.externalId + 'p');
      const ageH = (now.getTime() - r.createdAt.getTime()) / 3.6e6;
      return {
        platform: this.platform,
        externalId: r.externalId,
        authorHandle: '',
        text: '',
        url: '',
        createdAt: r.createdAt,
        ...this.engagement(seed, potential, ageH),
      } as RawPost;
    });
  }
}
