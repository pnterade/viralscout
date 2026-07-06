import 'dotenv/config';

function num(v: string | undefined, d: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
}

function bool(v: string | undefined, d: boolean): boolean {
  if (v === undefined) return d;
  return v.toLowerCase() === 'true';
}

export const config = {
  source: process.env.SOURCE || 'mock', // mock | twitterapi
  niches: (process.env.NICHES || 'memes,animals,politics,crypto,technology')
    .split(',').map((s) => s.trim()).filter(Boolean),
  queries: (process.env.QUERIES || '').split('|').map((s) => s.trim()).filter(Boolean),

  twitterApi: {
    baseUrl: process.env.TWITTERAPI_BASE_URL || 'https://api.twitterapi.io',
    apiKey: process.env.TWITTERAPI_KEY || '',
    // Free tier allows 1 request / 5s. Bump down after upgrading the plan.
    minIntervalMs: num(process.env.TWITTERAPI_MIN_INTERVAL_MS, 5200),
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
    enabled: !!process.env.ANTHROPIC_API_KEY,
  },

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    enabled: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  },

  scan: {
    intervalMinutes: num(process.env.SCAN_INTERVAL_MINUTES, 15),
    maxPerQuery: num(process.env.MAX_PER_QUERY, 30),
    // Only push the top-ranked N new posts each scan, so you aren't spammed.
    maxAlertsPerScan: num(process.env.MAX_ALERTS_PER_SCAN, 10),
    // Minimum likes floor in the search query — biases toward already-big posts.
    minFaves: num(process.env.MIN_FAVES, 3000),
    // If true, only video/gif posts qualify.
    requireVideo: (process.env.REQUIRE_VIDEO || 'false').toLowerCase() === 'true',
    // Share of each alert batch reserved for "upcoming" posts (rest are already-viral).
    upcomingRatio: num(process.env.UPCOMING_RATIO, 0.1),
  },

  // Only scan during these hours (in ACTIVE_TIMEZONE). Outside the window the bot idles.
  // Window is [startHour, endHour): default 07:00–21:00 (7 AM to 9 PM).
  schedule: {
    startHour: num(process.env.ACTIVE_START_HOUR, 7),
    endHour: num(process.env.ACTIVE_END_HOUR, 21),
    timezone: process.env.ACTIVE_TIMEZONE || 'Europe/Athens', // EEST/EET
  },

  filters: {
    dropGiveaways: bool(process.env.DROP_GIVEAWAYS, true), // giveaways / airdrops / promos
    dropSelfPromo: bool(process.env.DROP_SELF_PROMO, true), // follow-farming / self-promo threads
    dropOffTopic: bool(process.env.DROP_OFF_TOPIC, false), // posts Claude tags "other"
  },

  scoring: {
    notifyThreshold: num(process.env.NOTIFY_THRESHOLD, 0.6),
    // A post is "already viral" at/above this view count.
    viralViews: num(process.env.VIRAL_VIEWS, 200000),
    // "Upcoming" = views in [upcomingMinViews, viralViews) and rising fast.
    upcomingMinViews: num(process.env.UPCOMING_MIN_VIEWS, 50000),
    minTrainSamples: num(process.env.MIN_TRAIN_SAMPLES, 40),
  },

  taste: {
    // Feedback (👍/👎) needed before the taste model influences what you're sent.
    minFeedback: num(process.env.TASTE_MIN_FEEDBACK, 5),
    // Once trained, drop posts whose predicted "like" score is below this.
    dropThreshold: num(process.env.TASTE_DROP_THRESHOLD, 0.2),
    // How strongly taste bends the ranking (0 = off, 1 = strong).
    weight: num(process.env.TASTE_WEIGHT, 1),
  },

  tracking: {
    windowHours: num(process.env.TRACK_WINDOW_HOURS, 24),
    labelAfterHours: num(process.env.LABEL_AFTER_HOURS, 24),
  },
};
