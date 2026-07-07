import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { prisma } from '../db';
import { trainTaste } from '../learn/taste';
import { log } from '../logger';

let bot: TelegramBot | null = null;
function getBot(polling = false): TelegramBot {
  if (!bot) bot = new TelegramBot(config.telegram.token, { polling });
  return bot;
}

const fmt = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));

interface NotifiablePost {
  id: string;
  platform: string;
  stage: string | null;
  category: string | null;
  viralScore: number | null;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number | null;
  mediaType: string | null;
  authorHandle: string;
  authorFollowers: number | null;
  url: string;
}

const PLATFORM_LABEL: Record<string, string> = { twitter: '🐦 X', tiktok: '🎵 TikTok' };

/** Push a flagged post to Telegram (or log it if Telegram isn't configured). */
export async function notify(post: NotifiablePost): Promise<void> {
  const score = Math.round((post.viralScore ?? 0) * 100);
  if (!config.telegram.enabled) {
    log.info(`[alert:${post.stage}] ${score}% ${post.category} — ${post.url}`);
    return;
  }
  const isVideo = post.mediaType === 'video' || post.mediaType === 'gif';
  const badge = post.stage === 'already_viral' ? '🔥 VIRAL' : '📈 RISING';
  const clip = isVideo ? '🎬 ' : '';
  const platform = PLATFORM_LABEL[post.platform] ?? post.platform;
  // Plain text (no parse_mode): post content can contain *, _, [ etc. that break
  // Telegram's Markdown parser. Telegram still auto-links the URL.
  const text =
    `${platform}  ·  ${badge}  ·  ${clip}${(post.category ?? 'other').toUpperCase()}\n` +
    `👁️ ${fmt(post.views ?? 0)} views\n\n` +
    `${post.text}\n\n` +
    `❤️ ${fmt(post.likes)}   🔁 ${fmt(post.retweets)}   💬 ${fmt(post.replies)}\n` +
    `@${post.authorHandle} · ${fmt(post.authorFollowers ?? 0)} followers\n` +
    `${post.url}`;

  try {
    await getBot().sendMessage(config.telegram.chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👍 More like this', callback_data: `fb:like:${post.id}` },
            { text: '👎 Less like this', callback_data: `fb:dislike:${post.id}` },
          ],
        ],
      },
    });
  } catch (e) {
    log.error('telegram send failed:', e instanceof Error ? e.message : e);
  }
}

/**
 * Long-running listener: each 👍/👎 tap records your taste and immediately
 * retrains the taste model, so the very next scan reflects your preference.
 */
export function startFeedbackListener(): void {
  if (!config.telegram.enabled) {
    log.warn('Telegram not configured — feedback buttons disabled.');
    return;
  }
  const b = getBot(true);
  b.on('callback_query', async (q) => {
    const [, label, postId] = (q.data || '').split(':'); // label = like | dislike
    if (!postId || (label !== 'like' && label !== 'dislike')) return;
    try {
      await prisma.feedback.create({ data: { postId, label } });
      const res = await trainTaste();
      const note =
        label === 'like' ? '👍 Got it — more like this' : '👎 Got it — I’ll send fewer like this';
      const tail = res ? ` (learning from ${res.samples} ratings)` : '';
      await b.answerCallbackQuery(q.id, { text: note + tail });
    } catch (e) {
      log.error('feedback error', e);
    }
  });
  log.info('Telegram feedback listener started.');
}
