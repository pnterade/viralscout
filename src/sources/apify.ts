import { RawPost, Source, PostRef } from '../types';
import { config } from '../config';
import { log } from '../logger';

const ACTOR = 'clockworks~tiktok-scraper';

/**
 * TikTok data via Apify (clockworks/tiktok-scraper). Runs the actor synchronously
 * and reads back the dataset items. Only this file changes to swap provider.
 */
export class ApifyTikTokSource implements Source {
  name = 'apify';
  platform = 'tiktok';

  /** Run the actor with the given input and return its dataset items. */
  private async run(input: object): Promise<any[]> {
    const url =
      `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items` +
      `?token=${encodeURIComponent(config.apify.token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`apify ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return Array.isArray(data) ? data : (data.items ?? []);
  }

  private map(i: any): RawPost {
    const username: string = i.authorMeta?.name ?? '';
    const id = String(i.id ?? '');
    return {
      platform: 'tiktok',
      externalId: id,
      authorHandle: username,
      authorName: i.authorMeta?.nickName ?? username,
      authorFollowers: i.authorMeta?.fans,
      text: i.text ?? '',
      url: i.webVideoUrl ?? (username ? `https://www.tiktok.com/@${username}/video/${id}` : ''),
      mediaType: 'video',
      createdAt: i.createTimeISO ? new Date(i.createTimeISO) : new Date(),
      likes: i.diggCount ?? 0,
      retweets: i.shareCount ?? 0, // shares → "retweets" slot
      replies: i.commentCount ?? 0,
      quotes: 0,
      views: i.playCount ?? 0,
    };
  }

  async fetchCandidates(queries: string[], limit: number): Promise<RawPost[]> {
    try {
      // One run covers all niche hashtags; resultsPerPage is per hashtag.
      const items = await this.run({ hashtags: queries, resultsPerPage: limit, searchSection: '/video' });
      return items.map((i) => this.map(i));
    } catch (e) {
      log.error('[apify] tiktok fetch failed:', e);
      return [];
    }
  }

  async refresh(refs: PostRef[]): Promise<RawPost[]> {
    const urls = refs.map((r) => r.url).filter((u): u is string => !!u);
    if (!urls.length) return [];
    try {
      const items = await this.run({ postURLs: urls, resultsPerPage: 1 });
      return items.map((i) => this.map(i));
    } catch (e) {
      log.error('[apify] tiktok refresh failed:', e);
      return [];
    }
  }
}
