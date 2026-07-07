import { config } from '../config';
import { Source } from '../types';
import { MockSource } from './mock';
import { TwitterApiSource } from './twitterapi';
import { TikTokSource } from './tiktok';
import { ApifyTikTokSource } from './apify';

function makeSource(name: string): Source {
  switch (name) {
    case 'twitterapi':
      return new TwitterApiSource();
    case 'tiktok':
      return new ApifyTikTokSource(); // TikTok via Apify (default provider)
    case 'ensembledata':
      return new TikTokSource(); // TikTok via EnsembleData (alternative)
    case 'mocktiktok':
      return new MockSource('tiktok');
    case 'mock':
    default:
      return new MockSource('twitter');
  }
}

/** All configured data sources (X, TikTok, …) that run together each scan. */
export function getSources(): Source[] {
  return config.sources.map(makeSource);
}
