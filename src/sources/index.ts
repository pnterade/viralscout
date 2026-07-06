import { config } from '../config';
import { Source } from '../types';
import { MockSource } from './mock';
import { TwitterApiSource } from './twitterapi';

export function getSource(): Source {
  switch (config.source) {
    case 'twitterapi':
      return new TwitterApiSource();
    case 'mock':
    default:
      return new MockSource();
  }
}
