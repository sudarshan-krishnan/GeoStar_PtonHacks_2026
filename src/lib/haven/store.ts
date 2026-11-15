import { db } from '../db';
import {
  initialProtectionState,
  transitionProtection,
  type Facility,
  type ProtectionAction,
  type ProtectionState,
} from './engine';

// Additive storage in the existing SQLite database. Parameterized SQL also works with
// the current generated Prisma client while an original demo is running on Windows.
export async function ensureTable() {
  await db.$executeRaw`CREATE TABLE IF NOT EXISTS "ProtectionWorkspace" ("id" TEXT NOT NULL PRIMARY KEY, "snapshot" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
}
export async function loadProtection(facility: Facility): Promise<ProtectionState> {
  await ensureTable();
  const rows = await db.$queryRaw<
    { snapshot: string }[]
  >`SELECT "snapshot" FROM "ProtectionWorkspace" WHERE "id" = ${facility.id}`;
  return rows[0] ? JSON.parse(rows[0].snapshot) : initialProtectionState(facility);
}
export async function changeProtection(
  facility: Facility,
  revision: number,
  command: ProtectionAction,
) {
  await ensureTable();
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { snapshot: string }[]
    >`SELECT "snapshot" FROM "ProtectionWorkspace" WHERE "id" = ${facility.id}`;
    const previous: ProtectionState = rows[0]
      ? JSON.parse(rows[0].snapshot)
      : initialProtectionState(facility);
    if (previous.revision !== revision)
      throw new Error(
        'This facility changed in another window. Reload its latest state before retrying.',
      );
    const next = transitionProtection(previous, command);
    await tx.$executeRaw`INSERT INTO "ProtectionWorkspace" ("id", "snapshot", "updatedAt") VALUES (${facility.id}, ${JSON.stringify(next)}, CURRENT_TIMESTAMP) ON CONFLICT("id") DO UPDATE SET "snapshot" = excluded."snapshot", "updatedAt" = CURRENT_TIMESTAMP`;
    return next;
  });
}
