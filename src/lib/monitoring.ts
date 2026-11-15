import type { Prisma } from '@prisma/client';
import { db } from './db';
import type { Design, Project, Sensor } from './types';
import { sensorDefaults, incidentDetails } from './monitoring-rules';
export { sensorDefaults, incidentDetails } from './monitoring-rules';
export function sensorPlan(projectId: string, d: Design, type: string) {
  const sensors: Prisma.SensorCreateManyInput[] = [];
  const zones =
    type === 'park'
      ? ['Community pavilion', 'Restrooms', 'Irrigation plant']
      : ['West wing', 'East wing', 'Mechanical room'];
  for (let floor = 1; floor <= d.floors; floor++)
    for (let zi = 0; zi < zones.length; zi++) {
      const kinds = zi === 2 ? ['water', 'temperature', 'electrical'] : ['fire', 'temperature'];
      for (let ki = 0; ki < kinds.length; ki++) {
        const kind = kinds[ki],
          defaults = sensorDefaults[kind];
        sensors.push({
          projectId,
          name: `${defaults.label} · F${floor}-${zi + 1}`,
          type: kind,
          zone: zones[zi],
          floor,
          x: zi === 0 ? -d.width * 0.3 : zi === 1 ? d.width * 0.3 : 0,
          z: (ki - 1) * d.depth * 0.2,
          ...{ value: defaults.value, threshold: defaults.threshold, unit: defaults.unit },
          source: 'simulation',
        });
      }
    }
  return sensors;
}
export async function ingestReading(
  sensor: Sensor,
  value: number,
  source: 'hardware' | 'simulation',
  deviceId?: string,
) {
  return db.$transaction(async (tx) => {
    const updated = await tx.sensor.update({
      where: { id: sensor.id },
      data: { value, source, ...(deviceId ? { deviceId } : {}), lastSeen: new Date() },
    });
    if (
      value >= sensor.threshold &&
      !(await tx.incident.findFirst({
        where: { projectId: sensor.projectId, sensorId: sensor.id, status: { not: 'resolved' } },
      }))
    )
      await tx.incident.create({
        data: {
          projectId: sensor.projectId,
          sensorId: sensor.id,
          ...incidentDetails(sensor.type, sensor.zone, value, source),
        },
      });
    return updated;
  });
}
export async function simulate(p: Project, kind: string) {
  if (!p.approvedDesignId) throw new Error('Approve a design before running a simulation.');
  if (kind === 'reset') {
    await db.$transaction(async (tx) => {
      for (const s of p.sensors.filter((s) => s.source === 'simulation'))
        await tx.sensor.update({
          where: { id: s.id },
          data: { value: sensorDefaults[s.type].value, lastSeen: null },
        });
      await tx.incident.updateMany({
        where: { projectId: p.id, source: 'simulation', status: { not: 'resolved' } },
        data: { status: 'resolved' },
      });
      await tx.simulation.create({
        data: {
          projectId: p.id,
          kind,
          summary:
            'Simulation readings reset; simulated incidents resolved. Hardware readings retained.',
        },
      });
    });
    return;
  }
  const type = kind === 'water-leak' ? 'water' : kind === 'overheating' ? 'temperature' : 'fire';
  const s = p.sensors.find((s) => s.type === type && s.source !== 'hardware');
  if (!s) throw new Error('No simulation sensor of this type. Add one in the sensor editor.');
  const value =
    type === 'water'
      ? Math.max(88, s.threshold)
      : type === 'temperature'
        ? Math.max(58, s.threshold)
        : Math.max(1, s.threshold);
  await ingestReading(s, value, 'simulation');
  await db.simulation.create({
    data: {
      projectId: p.id,
      kind,
      summary: `${kind.replaceAll('-', ' ')} triggered in ${s.zone}, floor ${s.floor}. Guardian created or updated the monitoring incident.`,
    },
  });
}
