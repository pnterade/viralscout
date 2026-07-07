import { RawPost, Source, PostRef } from '../types';
import { config } from '../config';
import { log } from '../logger';

// Gentle throttle shared across all EnsembleData requests.
let lastRequestAt = 0;
async function throttle(minInterval: number): Promise<void> {
  const wait = lastRequestAt + minInterval - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/** Pull the posts array out of EnsembleData's response, tolerating shape variations. */
function extractPosts(body: any): any[] {
  const d = body?.data ?? body;
  if (Array.isArray(d)) return d;
  return d?.data ?? d?.aweme_list ?? d?.posts ?? [];
}

/**
 * TikTok data via EnsembleData (pay-as-you-go, free trial credits).
 * Keyword search + multi-post refresh. Only this file changes to swap provider.
 */
export class TikTokSource implements Source {
  name = 'ensembledata';
  platform = 'tiktok';

  private async get(path: string, params: Record<string, string>): Promise<any> {
    await throttle(config.ensemble.minIntervalMs);
    // baseUrl already includes the "/apis" path segment, so concatenate (don't use new URL(path, base)).
    const url = new URL(config.ensemble.baseUrl + path);
    url.searchParams.set('token', config.ensemble.token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ensembledata ${res.status}: ${await res.text()}`);
    return res.json();
  }

  private map(item: any): RawPost {
    const a = item.aweme_info ?? item;
    const author = a.author ?? {};
    const stats = a.statistics ?? {};
    const username: string = author.unique_id ?? author.uniqueId ?? '';
    const id = String(a.aweme_id ?? a.id ?? '');
    return {
      platform: 'tiktok',
      externalId: id,
      authorHandle: username,
      authorName: author.nickname,
      authorFollowers: author.follower_count ?? author.followerCount,
      text: a.desc ?? '',
      url: a.share_url ?? (username ? `https://www.tiktok.com/@${username}/video/${id}` : `https://www.tiktok.com/video/${id}`),
      mediaType: 'video', // TikTok is video-native
      createdAt: new Date((a.create_time ?? a.createTime ?? Date.now() / 1000) * 1000),
      likes: stats.digg_count ?? 0,
      retweets: stats.share_count ?? 0, // shares map to the "retweets" slot
      replies: stats.comment_count ?? 0,
      quotes: 0,
      views: stats.play_count ?? 0,
    };
  }

  async fetchCandidates(queries: string[], limit: number): Promise<RawPost[]> {
    const out: RawPost[] = [];
    for (const keyword of queries) {
      try {
        const body = await this.get('/tt/keyword/posts', { keyword, cursor: '0' });
        for (const p of extractPosts(body).slice(0, limit)) out.push(this.map(p));
      } catch (e) {
        log.error('[ensembledata] keyword search failed:', keyword, e);
      }
    }
    return out;
  }

  async refresh(refs: PostRef[]): Promise<RawPost[]> {
    if (!refs.length) return [];
    try {
      const body = await this.get('/tt/post-multi-info', { posts: refs.map((r) => r.externalId).join(',') });
      return extractPosts(body).map((p) => this.map(p));
    } catch (e) {
      log.error('[ensembledata] refresh failed:', e);
      return [];
    }
  }
}
