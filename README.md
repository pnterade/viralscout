# ViralScout

Scans X/Twitter for **rising** and **already-viral** posts in the niches you care about
(memes, animals, politics, crypto, technology), predicts how viral each one will get,
pushes the winners to **Telegram**, and **learns from outcomes** so its predictions get
better over time.

Built Twitter-first with a pluggable data-source layer — TikTok and Instagram adapters
can be added later without touching the rest of the pipeline.

## How it works

```
 fetch candidates ──▶ categorize ──▶ extract features ──▶ score ──▶ store + alert
   (sources/)         (Claude/kw)      (scoring/)       (model)      (Telegram)
        ▲                                                                 │
        └──────── refresh engagement over time ◀── grade outcome ◀────────┘
                        (learn/outcomes.ts)         retrain model (learn/train.ts)
```

- **Rising** = high engagement *velocity* (engagement per hour) but not yet huge.
- **Already viral** = weighted engagement already past the viral line (`VIRAL_COMPOSITE`).
- Each flagged post is **re-checked for up to 24h** to see if it actually blew up. That
  becomes a labeled training example, and the **virality model** retrains on it.
- **Taste model** (separate): every alert has 👍 "More like this" / 👎 "Less like this"
  buttons. Each tap retrains your taste model instantly — it boosts content like what you
  liked and suppresses (eventually drops) what you disliked. Run `npm run taste` to see
  your learned profile.

## Setup

> This machine blocks npm lifecycle scripts, so Prisma's client is generated manually below.

```bash
cd C:\Users\Gamer\Claude\viralscout
npm install --ignore-scripts
npx prisma generate      # generate the DB client
npx prisma db push       # create dev.db
cp .env.example .env      # then edit .env
```

## Try it immediately (no keys needed)

```bash
npm run demo    # proves the learning loop: trained model vs heuristic on held-out data
npm run scan    # runs a real scan against the mock source; alerts print to console
```

## Go live

1. **Data**: set `SOURCE=twitterapi` and add `TWITTERAPI_KEY` (from twitterapi.io).
2. **Telegram**: create a bot via [@BotFather](https://t.me/BotFather), put the token in
   `TELEGRAM_BOT_TOKEN`, and your chat id (from [@userinfobot](https://t.me/userinfobot))
   in `TELEGRAM_CHAT_ID`.
3. **Claude** (optional, better categorization): add `ANTHROPIC_API_KEY`.
4. Run the always-on service:

```bash
npm start       # scans every SCAN_INTERVAL_MINUTES, tracks growth, retrains hourly
```

## Commands

| Command          | What it does                                              |
| ---------------- | -------------------------------------------------------- |
| `npm run scan`   | One scan: fetch → score → alert on winners               |
| `npm run track`  | Re-check engagement growth of recent posts               |
| `npm run label`  | Grade matured posts (viral or not)                       |
| `npm run train`  | Retrain the virality model on graded outcomes            |
| `npm run taste`  | Show your learned 👍/👎 taste profile                     |
| `npm run cycle`  | scan → track → label → train, once                       |
| `npm run demo`   | Offline learning demonstration                           |
| `npm start`      | Run the scheduled 24/7 service                           |

## Adding TikTok / Instagram later

Implement the `Source` interface in `src/types.ts` (a `fetchCandidates` + `refresh`
method), register it in `src/sources/index.ts`, and set `SOURCE` accordingly. Everything
downstream — scoring, learning, delivery — already works per-platform.

## Deploying to a VPS later

It's a plain Node service with a SQLite file. To move to an always-on host: copy the repo,
`npm install`, switch `DATABASE_URL` to Postgres (change `provider` in
`prisma/schema.prisma`), and run `npm start` under a process manager (pm2/systemd).
