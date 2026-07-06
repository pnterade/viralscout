import { config } from './config';

const NICHE_TERMS: Record<string, string> = {
  memes: '(meme OR funny OR relatable OR lol)',
  animals: '(dog OR cat OR puppy OR animal OR pet)',
  politics: '(election OR senate OR congress OR policy OR president)',
  crypto: '(crypto OR bitcoin OR ethereum OR solana OR altcoin)',
  technology: '(AI OR tech OR startup OR software OR gadget)',
};

/** Build search queries from configured niches (or use explicit QUERIES override). */
export function buildQueries(): string[] {
  if (config.queries.length) return config.queries;
  const video = config.scan.requireVideo ? ' filter:native_video' : '';
  return config.niches.map((n) => {
    const term = NICHE_TERMS[n] || n;
    // High min_faves floor biases toward already-big posts (which carry the 200k+ views).
    return `${term} min_faves:${config.scan.minFaves} -filter:replies lang:en${video}`;
  });
}
