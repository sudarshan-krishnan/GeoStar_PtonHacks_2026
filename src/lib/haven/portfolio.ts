import {
  activeIncidents,
  buildingHealth,
  defaultProtections,
  initialProtectionState,
  transitionProtection,
  type Facility,
  type ProtectionAction,
  type ProtectionState,
} from './engine';

// Illustrative deployed projects so the Deployed Projects view shows more than one infrastructure
// type. They run the same deterministic HAVEN simulation as a user's own project. Not real sites.
export const SAMPLE_PREFIX = 'portfolio-';
const samples: {
  facility: Facility;
  limits: { electricity: number; waterUsage: number };
  baseline: { electricity: number; waterUsage: number };
  deployedHoursAgo: number;
  scenario?: ProtectionAction[];
}[] = [
  {
    facility: {
      id: 'portfolio-pecos-solar',
      name: 'Pecos Sun Ranch',
      city: 'Pecos, Texas',
      type: 'Solar farm',
    },
    limits: { electricity: 300, waterUsage: 20 },
    baseline: { electricity: 140, waterUsage: 4 },
    deployedHoursAgo: 340,
  },
  {
    facility: {
      id: 'portfolio-roscoe-wind',
      name: 'Roscoe Ridge Wind',
      city: 'Roscoe, Texas',
      type: 'Wind farm',
    },
    limits: { electricity: 400, waterUsage: 30 },
    baseline: { electricity: 210, waterUsage: 6 },
    deployedHoursAgo: 190,
    scenario: [{ action: 'trigger', kind: 'usage' }],
  },
  {
    facility: {
      id: 'portfolio-riverside-compute',
      name: 'Riverside Compute Hall',
      city: 'Austin, Texas',
      type: 'Data center',
    },
    limits: { electricity: 600, waterUsage: 70 },
    baseline: { electricity: 470, waterUsage: 40 },
    deployedHoursAgo: 96,
  },
  {
    facility: {
      id: 'portfolio-brazos-campus',
      name: 'Brazos Learning Campus',
      city: 'College Station, Texas',
      type: 'Campus',
    },
    limits: { electricity: 500, waterUsage: 50 },
    baseline: { electricity: 310, waterUsage: 22 },
    deployedHoursAgo: 52,
    scenario: [{ action: 'trigger', kind: 'leak' }, { action: 'reset' }],
  },
  {
    facility: {
      id: 'portfolio-midtown-housing',
      name: 'Midtown Residences',
      city: 'Houston, Texas',
      type: 'Housing',
    },
    limits: { electricity: 350, waterUsage: 60 },
    baseline: { electricity: 190, waterUsage: 28 },
    deployedHoursAgo: 20,
  },
];

export function sampleProjects(now = Date.now()): ProtectionState[] {
  return samples.map((sample) => {
    const deployedAt = new Date(now - sample.deployedHoursAgo * 3_600_000).toISOString();
    let state = initialProtectionState(sample.facility);
    state.baseline = { ...state.readings, ...sample.baseline };
    state.readings = { ...state.baseline };
    const setup: ProtectionAction[] = [
      { action: 'accept-model' },
      {
        action: 'configure',
        config: {
          ...structuredClone(defaultProtections),
          electricity: { enabled: true, limit: sample.limits.electricity },
          waterUsage: { enabled: true, limit: sample.limits.waterUsage },
        },
      },
      { action: 'place', plan: 'north' },
      { action: 'deploy' },
    ];
    for (const step of setup) state = transitionProtection(state, step, deployedAt);
    for (const step of sample.scenario || [])
      state = transitionProtection(state, step, new Date(now - 40 * 60_000).toISOString());
    return state;
  });
}

export interface DeployedProject {
  facility: Facility;
  sample: boolean;
  deployed: boolean;
  health: ReturnType<typeof buildingHealth>;
  activeIncidents: number;
  readings: { electricity: number | null; waterUsage: number | null };
  /** Configured alert limits, for drawing readings against them. */
  limits: { electricity: number; waterUsage: number };
  deployedAt: string | null;
}

export function summarizeProject(state: ProtectionState): DeployedProject {
  return {
    facility: state.facility,
    sample: state.facility.id.startsWith(SAMPLE_PREFIX),
    deployed: state.deployed,
    health: buildingHealth(state),
    activeIncidents: activeIncidents(state).length,
    readings: {
      electricity: state.config.electricity.enabled ? state.readings.electricity : null,
      waterUsage: state.config.waterUsage.enabled ? state.readings.waterUsage : null,
    },
    limits: {
      electricity: state.config.electricity.limit,
      waterUsage: state.config.waterUsage.limit,
    },
    deployedAt: state.deployedAt || null,
  };
}
