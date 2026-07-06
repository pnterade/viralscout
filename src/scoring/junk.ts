import { config } from '../config';

// Giveaways / airdrops / promos / shill spam.
const GIVEAWAY: RegExp[] = [
  /\bgiveaway(s)?\b/i,
  /\bair\s?drop(s)?\b/i,
  /\bfree\s+(nft|mint|token|tokens|crypto|coins?|\$?\d)/i,
  /\b(rt|retweet)\b[^.!?]{0,30}\b(to|and|&)\b[^.!?]{0,12}\bwin\b/i,
  /\benter\s+to\s+win\b/i,
  /\blike\s*(,|&|and)?\s*(rt|retweet)\s*(,|&|and)?\s*(follow)?\b/i,
  /\bwhitelist\b/i,
  /\bpre\s?sale\b/i,
  /\bpromo\s*code\b/i,
  /\buse\s+code\b/i,
  /\blink\s+in\s+bio\b/i,
  /\b(claim|mint)\s+(your|now|here|before)\b/i,
  /\bwl\s+spot(s)?\b/i,
  /\bnext\s+100x\b/i,
  /\bdon'?t\s+miss\s+(out|this\s+one)\b/i,
];

// Follow-farming / self-promo / thread-bait.
const SELF_PROMO: RegExp[] = [
  /\bfollow\s+(me|us)\b/i,
  /\bfollow\s+(for|4)\s+(a\s+)?follow\b/i,
  /\bf4f\b/i,
  /\bfollow\s*back\b/i,
  /\bfollback\b/i,
  /🧵/,
  /\ba\s+thread\b/i,
  /\bthread\s+(below|👇)/i,
  /\bturn\s+on\s+(post\s+)?notifications\b/i,
  /\blike\s+(and|&)\s+follow\b/i,
  /\bretweet\s+if\b/i,
  /\b(sub|subscribe)\s+to\s+my\b/i,
  /\bcheck\s+out\s+my\b/i,
  /\blink\s+(below|👇)\b/i,
  /\bdrop(ping)?\s+(your|ur)\s+(links?|handles?)\b/i,
];

const matchAny = (text: string, patterns: RegExp[]) => patterns.some((re) => re.test(text));

/** Returns a reason string if the post should be filtered as junk, else null. */
export function junkReason(text: string): string | null {
  if (config.filters.dropGiveaways && matchAny(text, GIVEAWAY)) return 'giveaway/promo';
  if (config.filters.dropSelfPromo && matchAny(text, SELF_PROMO)) return 'self-promo';
  return null;
}
