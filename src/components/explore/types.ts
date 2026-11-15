import type { GateResult, Site } from '@/lib/types';

export interface ExploreSite extends Site {
  letter: string;
  pillars: { people: number; planet: number; money: number; overall: number };
  supportableMw: number | null;
  propertyType?: string;
  propertySubtype?: string | null;
  matterportCount?: number;
  manuallyAdded?: boolean;
}

export type Tone = 'good' | 'check' | 'bad';

const PLAIN: Record<string, (g: GateResult) => string> = {
  'Residential proximity': (g) =>
    g.status === 'Fail' ? `Too close to homes (${g.value} m away)` : `Homes are ${g.value} m away`,
  'Flood exposure': (g) =>
    g.status === 'Fail' ? `In a FEMA flood zone (${g.value})` : g.status === 'Pass' ? 'Outside flood zones' : 'Flood risk to check',
  'Water stress': (g) => (g.status === 'Fail' ? 'Water is scarce here' : `Water stress: ${g.value ?? 'unknown'}`),
  'Grid proximity': (g) =>
    g.status === 'Pass' ? `${g.value} km to a high-voltage substation` : 'Far from high-voltage power',
};

export const plainGate = (g: GateResult) => (PLAIN[g.gate] ? PLAIN[g.gate](g) : g.reason);

export const GATE_TITLE: Record<string, string> = {
  'Residential proximity': 'Away from homes',
  'Flood exposure': 'Flood safe',
  'Water stress': 'Enough water',
  'Grid proximity': 'Near big power',
  'Sensitive places': 'Away from schools and churches',
  'Land in use': 'Land is free',
};

export function verdict(s: Pick<Site, 'screen'>): { label: string; tone: Tone; reason: string } {
  const st = s.screen?.status;
  const gates = s.screen?.gates ?? [];
  if (st === 'Fail') {
    const g = gates.find((x) => x.status === 'Fail')!;
    return { label: 'Not suitable', tone: 'bad', reason: plainGate(g) };
  }
  if (st === 'Needs review') {
    const g = gates.find((x) => x.status !== 'Pass')!;
    return { label: 'Check first', tone: 'check', reason: plainGate(g) };
  }
  const grid = gates.find((x) => x.gate === 'Grid proximity');
  return {
    label: 'Good fit',
    tone: 'good',
    reason: `Clear of homes and flood zones${grid?.value != null ? ` · ${grid.value} km to big power` : ''}`,
  };
}

export const fmtMoney = (n: number | null | undefined) =>
  n == null || n === 0
    ? 'Unknown'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const fmtNum = (n: number | null | undefined, d = 0) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: d }).format(n);
