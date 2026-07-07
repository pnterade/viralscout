import { prisma } from './db';
import { getSources } from './sources';
import { config } from './config';
import { buildQueries } from './queries';
import { categorizeBatch } from './scoring/categorize';
import { junkReason } from './scoring/junk';
import { extractFeatures, composite, ageHours } from './scoring/features';
import { scoreFeatures, classifyStage, viralViewsFor } from './scoring/predict';
import { loadModel } from './learn/train';
import { loadTasteModel, tasteScore, tasteActive } from './learn/taste';
import { notify } from './delivery/telegram';
import { RawPost } from './types';
import { log } from './logger';

/** One scan: fetch from every source, score them, store + alert on the promising ones. */
export async function scan(): Promise<void> {
  const sources = getSources();
  log.info(`Scanning ${sources.length} source(s): ${sources.map((s) => s.platform).join(', ')}...`);

  // Fetch from every platform and merge into one candidate pool.
  let raw: RawPost[] = [];
  for (const source of sources) {
    try {
      const got = await source.fetchCandidates(buildQueries(source.platform), config.scan.maxPerQuery);
      log.info(`  ${source.platform} (${source.name}): ${got.length} candidates`);
      raw = raw.concat(got);
    } catch (e) {
      log.error(`source ${source.name} failed:`, e);
    }
  }
  log.info(`Fetched ${raw.length} total candidates.`);
  if (!raw.length) return;

  // Junk filter (giveaways/promos, follow-farming/self-promo) before anything else.
  const dropped: Record<string, number> = {};
  const kept = raw.filter((p) => {
    const reason = junkReason(p.text);
    if (reason) {
      dropped[reason] = (dropped[reason] ?? 0) + 1;
      return false;
    }
    return true;
  });
  if (Object.keys(dropped).length) log.info(`Filtered junk: ${JSON.stringify(dropped)}.`);

  // Dedupe BEFORE categorizing — Claude is the paid step, so only ever send it posts
  // we haven't seen. After warm-up most candidates are repeats, so this is a big saving.
  const existing = await prisma.post.findMany({
    where: { externalId: { in: kept.map((p) => p.externalId) } },
    select: { platform: true, externalId: true },
  });
  const seen = new Set(existing.map((e) => `${e.platform}:${e.externalId}`));
  const fresh = kept.filter((p) => !seen.has(`${p.platform}:${p.externalId}`));
  log.info(`${fresh.length} new post(s) to categorize (skipped ${kept.length - fresh.length} already seen).`);
  if (!fresh.length) return;

  const model = await loadModel();
  const taste = await loadTasteModel();
  const tasteOn = tasteActive(taste);
  const cats = await categorizeBatch(fresh);

  // Score + store every new, non-ignored post; collect them (with taste) for ranking.
  const flaggedPosts: { post: Awaited<ReturnType<typeof prisma.post.create>>; taste: number }[] = [];
  let tasteDropped = 0;
  for (let i = 0; i < fresh.length; i++) {
    const p = fresh[i];
    const category = cats[i];

    const isVideo = p.mediaType === 'video' || p.mediaType === 'gif';
    if (config.scan.requireVideo && !isVideo) continue;
    if (config.filters.dropOffTopic && category === 'other') continue;

    const features = extractFeatures(p, category);
    const score = scoreFeatures(model, features);
    const stage = classifyStage(p, score);
    if (stage === 'ignore') continue;

    // Taste: once you've rated enough, drop things you've taught it you dislike.
    const tScore = tasteScore(taste, features);
    if (tasteOn && tScore < config.taste.dropThreshold) {
      tasteDropped++;
      continue;
    }

    const post = await prisma.post.create({
      data: {
        platform: p.platform,
        externalId: p.externalId,
        authorHandle: p.authorHandle,
        authorName: p.authorName,
        authorFollowers: p.authorFollowers,
        text: p.text,
        url: p.url,
        mediaType: p.mediaType,
        createdAt: p.createdAt,
        likes: p.likes,
        retweets: p.retweets,
        replies: p.replies,
        quotes: p.quotes,
        views: p.views,
        category,
        viralScore: score,
        stage,
        peakComposite: composite(p),
        peakViews: p.views ?? 0,
        notified: false,
        prediction: { create: { features: JSON.stringify(features), predicted: score } },
        snapshots: {
          create: {
            ageHours: ageHours(p.createdAt),
            likes: p.likes,
            retweets: p.retweets,
            replies: p.replies,
            quotes: p.quotes,
            views: p.views,
            score: composite(p),
          },
        },
      },
    });
    flaggedPosts.push({ post, taste: tScore });
  }
  if (tasteDropped) log.info(`Taste model suppressed ${tasteDropped} post(s) you'd likely dislike.`);

  // Taste bends the ranking: a liked-type post ranks as if it had up to ~1.5x its views,
  // a disliked-type as little as ~0.5x. So your preferences steadily reshape the feed.
  const mult = (t: number) => Math.max(0.1, 1 + (t - 0.5) * config.taste.weight);

  // Rank already-viral posts by their "virality multiple" (views ÷ that platform's viral
  // bar), so a TikTok's millions don't automatically bury a strong X post — each competes
  // relative to its own platform. Taste still bends the order.
  const viralMultiple = (post: { views: number | null; platform: string }) =>
    (post.views ?? 0) / viralViewsFor(post.platform);
  const viral = flaggedPosts
    .filter((f) => f.post.stage === 'already_viral')
    .sort((a, b) => viralMultiple(b.post) * mult(b.taste) - viralMultiple(a.post) * mult(a.taste));
  const upcoming = flaggedPosts
    .filter((f) => f.post.stage === 'upcoming')
    .sort((a, b) => (b.post.viralScore ?? 0) * mult(b.taste) - (a.post.viralScore ?? 0) * mult(a.taste));

  const max = config.scan.maxAlertsPerScan;
  const upCount = Math.min(upcoming.length, Math.round(max * config.scan.upcomingRatio));
  const viralCount = Math.min(viral.length, max - upCount);
  const toAlert = [...viral.slice(0, viralCount), ...upcoming.slice(0, upCount)];

  for (const { post } of toAlert) {
    await notify(post);
    await prisma.post.update({ where: { id: post.id }, data: { notified: true } });
  }
  log.info(
    `Flagged ${flaggedPosts.length} (viral ${viral.length}, upcoming ${upcoming.length}); ` +
      `alerted ${toAlert.length} (${viralCount} viral + ${upCount} upcoming).`,
  );
}
