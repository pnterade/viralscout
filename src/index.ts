import { scan } from './pipeline';
import { track, label } from './learn/outcomes';
import { train } from './learn/train';
import { trainTaste, tasteReport } from './learn/taste';
import { runDemo } from './demo';
import { prisma } from './db';
import { log } from './logger';

async function main(): Promise<void> {
  const cmd = process.argv[2] || 'scan';
  switch (cmd) {
    case 'scan':
      await scan();
      break;
    case 'track':
      await track();
      break;
    case 'label':
      await label();
      break;
    case 'train':
      await train();
      break;
    case 'traintaste':
      await trainTaste();
      break;
    case 'taste':
      await tasteReport();
      break;
    case 'cycle':
      await scan();
      await track();
      await label();
      await train();
      await trainTaste();
      break;
    case 'demo':
      await runDemo();
      break;
    default:
      log.error(`Unknown command "${cmd}". Use: scan | track | label | train | traintaste | taste | cycle | demo`);
      process.exitCode = 1;
  }
  await prisma.$disconnect();
  process.exit(process.exitCode ?? 0);
}

main();
