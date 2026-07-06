import cron from 'node-cron';
import { config } from './config';
import { scan } from './pipeline';
import { track, label } from './learn/outcomes';
import { train } from './learn/train';
import { trainTaste } from './learn/taste';
import { startFeedbackListener } from './delivery/telegram';
import { log } from './logger';

/** Current hour (0–23) in the configured timezone, regardless of the server's clock. */
function currentHour(): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: config.schedule.timezone,
    hour: '2-digit',
    hour12: false,
  }).format(new Date());
  return Number(s) % 24; // %24 handles the "24" some locales emit at midnight
}

/** Are we inside the active window? Supports overnight windows (e.g. 22→6) too. */
function withinActiveHours(): boolean {
  const h = currentHour();
  const { startHour, endHour } = config.schedule;
  return startHour <= endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
}

async function cycle(): Promise<void> {
  if (!withinActiveHours()) {
    log.info(
      `Outside active hours (${config.schedule.startHour}:00–${config.schedule.endHour}:00 ${config.schedule.timezone}) — skipping.`,
    );
    return;
  }
  try {
    await scan();
    await track();
    await label();
  } catch (e) {
    log.error('cycle error', e);
  }
}

async function main(): Promise<void> {
  startFeedbackListener();
  await cycle();

  cron.schedule(`*/${config.scan.intervalMinutes} * * * *`, cycle);
  cron.schedule('0 * * * *', async () => {
    try {
      await train();
      await trainTaste();
    } catch (e) {
      log.error('train error', e);
    }
  });

  log.info(
    `Scheduler running — scan every ${config.scan.intervalMinutes}m during ` +
      `${config.schedule.startHour}:00–${config.schedule.endHour}:00 ${config.schedule.timezone}, retrain hourly. Ctrl+C to stop.`,
  );
}

main();
