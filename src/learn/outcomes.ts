import { prisma } from '../db';
import { getSources } from '../sources';
import { config } from '../config';
import { composite, ageHours } from '../scoring/features';
import { viralViewsFor } from '../scoring/predict';
import { log } from '../logger';

/** Re-fetch engagement for recently-discovered posts and record growth snapshots. */
export async function track(): Promise<void> {
  const since = new Date(Date.now() - config.tracking.windowHours * 3.6e6);
  const posts = await prisma.post.findMany({ where: { discoveredAt: { gte: since } } });
  if (!posts.length) return;

  // Each post is refreshed by the source that owns its platform.
  const sourceByPlatform = new Map(getSources().map((s) => [s.platform, s]));
  const byPlatform = new Map<string, typeof posts>();
  for (const p of posts) {
    const arr = byPlatform.get(p.platform);
    if (arr) arr.push(p);
    else byPlatform.set(p.platform, [p]);
  }

  let updated = 0;
  for (const [platform, group] of byPlatform) {
    const source = sourceByPlatform.get(platform);
    if (!source) continue; // platform not currently configured — skip its posts
    const fresh = await source.refresh(group.map((p) => ({ externalId: p.externalId, createdAt: p.createdAt })));
    const byId = new Map(fresh.map((f) => [f.externalId, f]));

    for (const p of group) {
      const f = byId.get(p.externalId);
      if (!f) continue;
      const comp = composite(f);
      await prisma.snapshot.create({
        data: {
          postId: p.id,
          ageHours: ageHours(p.createdAt),
          likes: f.likes,
          retweets: f.retweets,
          replies: f.replies,
          quotes: f.quotes,
          views: f.views,
          score: comp,
        },
      });
      if (comp > p.peakComposite || (f.views ?? 0) > p.peakViews) {
        await prisma.post.update({
          where: { id: p.id },
          data: {
            peakComposite: Math.max(comp, p.peakComposite),
            peakViews: Math.max(f.views ?? 0, p.peakViews),
            likes: f.likes,
            retweets: f.retweets,
            replies: f.replies,
            quotes: f.quotes,
            views: f.views,
          },
        });
      }
      updated++;
    }
  }
  log.info(`Tracked growth on ${updated} posts.`);
}

/** Grade posts that are old enough: did they actually cross their platform's viral line? */
export async function label(): Promise<void> {
  const cutoff = new Date(Date.now() - config.tracking.labelAfterHours * 3.6e6);
  const preds = await prisma.prediction.findMany({
    where: { outcomeKnown: false, post: { discoveredAt: { lte: cutoff } } },
    include: { post: true },
  });

  let labeled = 0;
  for (const pr of preds) {
    const wentViral = pr.post.peakViews >= viralViewsFor(pr.post.platform);
    await prisma.prediction.update({
      where: { id: pr.id },
      data: { outcomeKnown: true, wentViral, peakScore: pr.post.peakViews, labeledAt: new Date() },
    });
    labeled++;
  }
  if (labeled) log.info(`Graded ${labeled} outcomes.`);
}
