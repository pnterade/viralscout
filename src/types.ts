export interface RawPost {
  platform: string;
  externalId: string;
  authorHandle: string;
  authorName?: string;
  authorFollowers?: number;
  text: string;
  url: string;
  mediaType?: string; // none | photo | video | gif
  createdAt: Date;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  views?: number;
}

export interface PostRef {
  externalId: string;
  createdAt: Date;
}

/** A pluggable data source. Multiple can run at once (X + TikTok + …). */
export interface Source {
  name: string;
  /** Platform these posts belong to: 'twitter' | 'tiktok' | … */
  platform: string;
  /** Search for fresh candidate posts across the given queries. */
  fetchCandidates(queries: string[], limit: number): Promise<RawPost[]>;
  /** Re-fetch current engagement for known posts, to measure growth. */
  refresh(refs: PostRef[]): Promise<RawPost[]>;
}
