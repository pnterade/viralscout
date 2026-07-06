import { prisma } from './db';
import { getSource } from './sources';
import { config } from './config';
import { buildQueries } from './queries';
import { categorizeBatch } from './scoring/categorize';
import { junkReason } from './scoring/junk';
import { extractFeatures, composite, ageHours } from './scoring/features';
import { scoreFeatures, classifyStage } from './scoring/predict';
import { loadModel } from './learn/train';
import { loadTasteModel, tasteScore, tasteActive } from './learn/taste';
import { notify } from './delivery/telegram';
import { log } from './logger';

/** One scan: fetch candidates, score them, store + alert on the promising ones. */
export async function scan(): Promise<void> {
  const source = getSource();
  const queries = buildQueries();
  log.info(`Scanning via "${source.name}" across ${queries.length} queries...`);

  const raw = await source.fetchCandidates(queries, config.scan.maxPerQuery);
  log.info(`Fetched ${raw.length} candidates.`);
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

  // Build a mostly-viral alert batch: already-viral first (by taste-weighted views,
  // videos and non-videos alike), reserving a small share for "upcoming" posts.
  const viral = flaggedPosts
    .filter((f) => f.post.stage === 'already_viral')
    .sort((a, b) => (b.post.views ?? 0) * mult(b.taste) - (a.post.views ?? 0) * mult(a.taste));
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
