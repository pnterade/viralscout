import { config } from '../config';
import { Source } from '../types';
import { MockSource } from './mock';
import { TwitterApiSource } from './twitterapi';
import { TikTokSource } from './tiktok';

function makeSource(name: string): Source {
  switch (name) {
    case 'twitterapi':
      return new TwitterApiSource();
    case 'tiktok':
      return new TikTokSource(); // EnsembleData
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
