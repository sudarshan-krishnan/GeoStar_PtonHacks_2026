import { existsSync, closeSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
// Prisma on Windows can fail with an opaque schema-engine error for a missing file.
// Do not truncate an existing database or reinterpret custom DATABASE_URL values.
const path = resolve('prisma/plotstar.db');
if (!existsSync(path)) closeSync(openSync(path, 'a'));
