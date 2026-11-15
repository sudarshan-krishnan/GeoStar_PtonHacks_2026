import 'dotenv/config';
import { ensureDemos } from '../src/lib/projects';
import { db } from '../src/lib/db';
ensureDemos()
  .then(() => console.log('Three PlotStar demonstrations ready.'))
  .finally(() => db.$disconnect());
