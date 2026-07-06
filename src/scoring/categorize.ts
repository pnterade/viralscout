import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { CATEGORIES } from './features';
import { RawPost } from '../types';

const KEYWORDS: Record<string, string[]> = {
  memes: ['meme', 'lol', 'lmao', '😂', '🤣', '💀', 'relatable', 'pov', 'when you', 'nobody:'],
  animals: ['dog', 'cat', 'puppy', 'kitten', 'animal', 'pet', '🐶', '🐱', 'wildlife', 'retriever'],
  politics: ['election', 'president', 'senate', 'congress', 'policy', 'government', 'vote', 'debate', 'bill'],
  crypto: ['bitcoin', 'btc', 'eth', 'ethereum', 'crypto', 'solana', 'sol', 'token', 'airdrop', 'altcoin'],
  technology: ['ai', 'gpt', 'tech', 'startup', 'app', 'software', 'iphone', 'google', 'openai', 'nvidia'],
};

export function keywordCategory(p: RawPost): string {
  const t = p.text.toLowerCase();
  let best = 'other';
  let score = 0;
  for (const [cat, kws] of Object.entries(KEYWORDS)) {
    const s = kws.reduce((a, k) => a + (t.includes(k) ? 1 : 0), 0);
    if (s > score) {
      score = s;
      best = cat;
    }
  }
  return best;
}

let client: Anthropic | null = null;

/** Categorize a batch of posts in one Claude call, with a keyword fallback. */
export async function categorizeBatch(posts: RawPost[]): Promise<string[]> {
  if (!posts.length) return [];
  if (!config.anthropic.enabled) return posts.map(keywordCategory);
  try {
    client = client || new Anthropic({ apiKey: config.anthropic.apiKey });
    const list = posts.map((p, i) => `${i + 1}. ${p.text.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');
    const msg = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 1000,
      system:
        `Classify each numbered tweet into exactly one category from: ${CATEGORIES.join(', ')}. ` +
        `Reply ONLY with a JSON array of lowercase category strings, in order. ` +
        `Example: ["memes","crypto","other"]`,
      messages: [{ role: 'user', content: list }],
    });
    const txt = (msg.content[0] as { text?: string })?.text?.trim() || '[]';
    const json = txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1);
    const arr = JSON.parse(json) as string[];
    return posts.map((p, i) => ((CATEGORIES as readonly string[]).includes(arr[i]) ? arr[i] : keywordCategory(p)));
  } catch {
    return posts.map(keywordCategory);
  }
}
