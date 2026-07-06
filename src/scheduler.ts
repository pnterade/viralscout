import cron from 'node-cron';
import { config } from './config';
import { scan } from './pipeline';
import { track, label } from './learn/outcomes';
import { train } from './learn/train';
import { trainTaste } from './learn/taste';
import { startFeedbackListener } from './delivery/telegram';
import { log } from './logger';

async function cycle(): Promise<void> {
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

  log.info(`Scheduler running — scan every ${config.scan.intervalMinutes}m, retrain hourly. Ctrl+C to stop.`);
}

main();
