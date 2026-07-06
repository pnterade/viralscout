import { RawPost, Source, PostRef } from '../types';
import { config } from '../config';
import { log } from '../logger';

// Module-level throttle so every request (search + refresh) respects the plan's QPS limit.
let lastRequestAt = 0;
async function throttle(minInterval: number): Promise<void> {
  const wait = lastRequestAt + minInterval - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/**
 * Real X/Twitter data via twitterapi.io (pay-as-you-go, no X approval needed).
 * Field mapping is defensive so it also tolerates official X API v2 shapes.
 * To switch providers later, only this file needs to change.
 */
export class TwitterApiSource implements Source {
  name = 'twitterapi';

  private async get(path: string, params: Record<string, string>): Promise<any> {
    await throttle(config.twitterApi.minIntervalMs);
    const url = new URL(path, config.twitterApi.baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { 'X-API-Key': config.twitterApi.apiKey } });
    if (!res.ok) throw new Error(`twitterapi ${res.status}: ${await res.text()}`);
    return res.json();
  }

  private mediaType(t: any): string {
    const m = t.extendedEntities?.media ?? t.media ?? [];
    if (!m.length) return 'none';
    const type = m[0].type;
    return type === 'animated_gif' ? 'gif' : type === 'video' ? 'video' : 'photo';
  }

  private map(t: any): RawPost {
    return {
      platform: 'twitter',
      externalId: String(t.id ?? t.id_str),
      authorHandle: t.author?.userName ?? t.author?.screen_name ?? '',
      authorName: t.author?.name,
      authorFollowers: t.author?.followers ?? t.author?.followers_count,
      text: t.text ?? t.full_text ?? '',
      url: t.url ?? `https://twitter.com/i/status/${t.id}`,
      mediaType: this.mediaType(t),
      createdAt: new Date(t.createdAt ?? t.created_at ?? Date.now()),
      likes: t.likeCount ?? t.favorite_count ?? 0,
      retweets: t.retweetCount ?? t.retweet_count ?? 0,
      replies: t.replyCount ?? 0,
      quotes: t.quoteCount ?? 0,
      views: t.viewCount ?? undefined,
    };
  }

  async fetchCandidates(queries: string[], limit: number): Promise<RawPost[]> {
    const out: RawPost[] = [];
    for (const q of queries) {
      try {
        const data = await this.get('/twitter/tweet/advanced_search', { query: q, queryType: 'Latest' });
        const tweets: any[] = data.tweets ?? data.data ?? [];
        for (const t of tweets.slice(0, limit)) out.push(this.map(t));
      } catch (e) {
        log.error('[twitterapi] query failed:', q, e);
      }
    }
    return out;
  }

  async refresh(refs: PostRef[]): Promise<RawPost[]> {
    if (!refs.length) return [];
    try {
      const data = await this.get('/twitter/tweets', { tweet_ids: refs.map((r) => r.externalId).join(',') });
      const tweets: any[] = data.tweets ?? data.data ?? [];
      return tweets.map((t) => this.map(t));
    } catch (e) {
      log.error('[twitterapi] refresh failed:', e);
      return [];
    }
  }
}
