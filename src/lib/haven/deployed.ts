import { db } from '../db';
import type { ProtectionState } from './engine';
import { sampleProjects, summarizeProject, type DeployedProject } from './portfolio';
import { ensureTable } from './store';
// "Reset preview" clears a Dashboard 2 project's saved HAVEN workspace. Sample projects are kept.
export async function resetWorkspace(id: string) {
  if (!id.startsWith('d2-')) return false;
  await ensureTable();
  await db.$executeRaw`DELETE FROM "ProtectionWorkspace" WHERE "id" = ${id}`;
  return true;
}

// Every project that has been deployed at least once, including ones paused for edits.
// Sample projects are inserted once and then keep their own persisted simulation state.
export async function listDeployed(): Promise<DeployedProject[]> {
  await ensureTable();
  for (const sample of sampleProjects())
    await db.$executeRaw`INSERT OR IGNORE INTO "ProtectionWorkspace" ("id", "snapshot", "updatedAt") VALUES (${sample.facility.id}, ${JSON.stringify(sample)}, CURRENT_TIMESTAMP)`;
  const rows = await db.$queryRaw<
    { snapshot: string }[]
  >`SELECT "snapshot" FROM "ProtectionWorkspace" ORDER BY "updatedAt" DESC`;
  return rows
    .map((row) => JSON.parse(row.snapshot) as ProtectionState)
    .filter((state) => state.deployed || state.deployedAt)
    .map(summarizeProject);
}
