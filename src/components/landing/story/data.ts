// Copy and illustrative figures for the landing story. Site scores are a teaching example of how the
// ranking reacts to priorities; they are not analysis of real parcels.
import type { PreviewProjectType } from '@/components/dashboard-2/sample-data';

export type Factor = { id: string; label: string; hint: string; weight: number };
export type Candidate = { id: string; name: string; place: string; scores: Record<string, number> };
export type TypeStory = {
  id: PreviewProjectType;
  label: string;
  short: string;
  question: string;
  factors: Factor[];
  sites: Candidate[];
};

export const TYPES: TypeStory[] = [
  {
    id: 'data-center',
    label: 'Data center',
    short: 'Data center',
    question: 'Where can 20 MW get power, water and a welcome?',
    factors: [
      { id: 'grid', label: 'Power grid access', hint: 'Distance to a substation with spare capacity', weight: 9 },
      { id: 'water', label: 'Water supply', hint: 'Cooling water against local water stress', weight: 7 },
      { id: 'roi', label: 'Return on investment', hint: 'Land, power price, tax and time to power', weight: 8 },
      { id: 'people', label: 'Distance from homes', hint: 'Noise and light at the nearest home', weight: 6 },
      { id: 'flood', label: 'Flood safety', hint: 'Outside the 100-year floodplain', weight: 5 },
    ],
    sites: [
      { id: 'a', name: 'Parcel A', place: 'North industrial', scores: { grid: 92, water: 58, roi: 74, people: 81, flood: 88 } },
      { id: 'b', name: 'Parcel B', place: 'East ship channel', scores: { grid: 78, water: 86, roi: 69, people: 52, flood: 41 } },
      { id: 'c', name: 'Parcel C', place: 'West rail corridor', scores: { grid: 61, water: 72, roi: 90, people: 77, flood: 79 } },
    ],
  },
  {
    id: 'residential',
    label: 'Residential',
    short: 'Homes',
    question: 'Where will a family want to wake up?',
    factors: [
      { id: 'school', label: 'Good elementary schools', hint: 'Rated schools within a short walk', weight: 9 },
      { id: 'park', label: 'Parks nearby', hint: 'Green space within ten minutes on foot', weight: 7 },
      { id: 'river', label: 'Riverfront', hint: 'Views and trails along the water', weight: 5 },
      { id: 'transit', label: 'Transit and jobs', hint: 'Commute time to the main job centres', weight: 6 },
      { id: 'roi', label: 'Return on investment', hint: 'Land cost against expected rents', weight: 7 },
    ],
    sites: [
      { id: 'a', name: 'Parcel A', place: 'Bayou bend', scores: { school: 71, park: 93, river: 96, transit: 54, roi: 62 } },
      { id: 'b', name: 'Parcel B', place: 'Heights grid', scores: { school: 94, park: 76, river: 40, transit: 81, roi: 58 } },
      { id: 'c', name: 'Parcel C', place: 'Ring-road edge', scores: { school: 63, park: 58, river: 35, transit: 66, roi: 92 } },
    ],
  },
  {
    id: 'commercial',
    label: 'Commercial',
    short: 'Commercial',
    question: 'Where will people walk in through the door?',
    factors: [
      { id: 'foot', label: 'Foot traffic', hint: 'People passing at peak hours', weight: 9 },
      { id: 'access', label: 'Road and transit access', hint: 'Easy in, easy out, easy to park', weight: 7 },
      { id: 'tenants', label: 'Tenant demand', hint: 'Vacancy and absorption nearby', weight: 8 },
      { id: 'roi', label: 'Return on investment', hint: 'Rents against land and build cost', weight: 8 },
      { id: 'zoning', label: 'Zoning fit', hint: 'How much the plan needs to change', weight: 4 },
    ],
    sites: [
      { id: 'a', name: 'Parcel A', place: 'Midtown corner', scores: { foot: 95, access: 70, tenants: 82, roi: 55, zoning: 74 } },
      { id: 'b', name: 'Parcel B', place: 'Freeway frontage', scores: { foot: 48, access: 94, tenants: 66, roi: 81, zoning: 90 } },
      { id: 'c', name: 'Parcel C', place: 'Campus edge', scores: { foot: 78, access: 63, tenants: 88, roi: 72, zoning: 61 } },
    ],
  },
  {
    id: 'solar',
    label: 'Solar farm',
    short: 'Solar',
    question: 'Where does the sun pay back fastest?',
    factors: [
      { id: 'sun', label: 'Sunlight', hint: 'Annual irradiance on a tilted panel', weight: 9 },
      { id: 'grid', label: 'Grid interconnect', hint: 'Queue position and line capacity', weight: 8 },
      { id: 'land', label: 'Flat, open land', hint: 'Slope, shade and clearing needed', weight: 6 },
      { id: 'roi', label: 'Return on investment', hint: 'Lease, build and power price', weight: 7 },
      { id: 'habitat', label: 'Habitat impact', hint: 'Wetlands and protected species', weight: 5 },
    ],
    sites: [
      { id: 'a', name: 'Parcel A', place: 'Rice-field flats', scores: { sun: 84, grid: 60, land: 95, roi: 76, habitat: 70 } },
      { id: 'b', name: 'Parcel B', place: 'Substation edge', scores: { sun: 80, grid: 96, land: 66, roi: 71, habitat: 82 } },
      { id: 'c', name: 'Parcel C', place: 'Prairie ranch', scores: { sun: 91, grid: 52, land: 88, roi: 84, habitat: 48 } },
    ],
  },
  {
    id: 'wind',
    label: 'Wind farm',
    short: 'Wind',
    question: 'Where does the wind blow, and the town agree?',
    factors: [
      { id: 'wind', label: 'Wind speed', hint: 'Average at hub height', weight: 9 },
      { id: 'grid', label: 'Grid interconnect', hint: 'Line capacity to carry the output', weight: 8 },
      { id: 'people', label: 'Distance from homes', hint: 'Sound and shadow flicker setbacks', weight: 7 },
      { id: 'roi', label: 'Return on investment', hint: 'Lease, turbines and power price', weight: 7 },
      { id: 'birds', label: 'Bird corridors', hint: 'Migration routes and roosts', weight: 4 },
    ],
    sites: [
      { id: 'a', name: 'Parcel A', place: 'Coastal ridge', scores: { wind: 96, grid: 58, people: 74, roi: 80, birds: 44 } },
      { id: 'b', name: 'Parcel B', place: 'Inland plain', scores: { wind: 72, grid: 90, people: 88, roi: 69, birds: 85 } },
      { id: 'c', name: 'Parcel C', place: 'Farm belt', scores: { wind: 84, grid: 75, people: 61, roi: 86, birds: 70 } },
    ],
  },
  {
    id: 'park',
    label: 'Park',
    short: 'Park',
    question: 'Where would a park change the most lives?',
    factors: [
      { id: 'need', label: 'Neighbourhood need', hint: 'Homes with no park in a ten-minute walk', weight: 9 },
      { id: 'walk', label: 'Walkability', hint: 'Safe crossings and sidewalks to the gate', weight: 7 },
      { id: 'kids', label: 'Schools and families', hint: 'Children living close by', weight: 6 },
      { id: 'water', label: 'Stormwater relief', hint: 'Room to soak up a heavy storm', weight: 5 },
      { id: 'cost', label: 'Land cost', hint: 'Acquisition and upkeep', weight: 6 },
    ],
    sites: [
      { id: 'a', name: 'Parcel A', place: 'Fifth Ward lot', scores: { need: 97, walk: 72, kids: 88, water: 64, cost: 70 } },
      { id: 'b', name: 'Parcel B', place: 'Bayou easement', scores: { need: 70, walk: 66, kids: 61, water: 96, cost: 85 } },
      { id: 'c', name: 'Parcel C', place: 'Old mall site', scores: { need: 81, walk: 90, kids: 74, water: 52, cost: 48 } },
    ],
  },
];

export const score = (site: Candidate, factors: Factor[]) => {
  const total = factors.reduce((s, f) => s + f.weight, 0) || 1;
  return Math.round(factors.reduce((s, f) => s + f.weight * (site.scores[f.id] ?? 0), 0) / total);
};

/** Sensors drawn in the Protect cutaway. x/y are percentages of the drawing. */
export type Sensor = {
  id: string;
  kind: 'water' | 'electric' | 'smoke' | 'structure';
  x: number;
  y: number;
  label: string;
  why: string;
};

export const SENSORS: Sensor[] = [
  { id: 'w1', kind: 'water', x: 30, y: 33, label: 'Riser leak sensor', why: 'A pinhole leak inside a wall can rot framing for months before a stain shows.' },
  { id: 'w2', kind: 'water', x: 68, y: 60, label: 'Water heater pan', why: 'Tanks fail at the seam. Catching the first litre saves the floor below.' },
  { id: 'w3', kind: 'water', x: 20, y: 84, label: 'Basement flow meter', why: 'Water running at 3 a.m. with nobody home means something burst.' },
  { id: 'e1', kind: 'electric', x: 82, y: 82, label: 'Panel arc-fault monitor', why: 'Loose connections arc and heat for weeks. That is the fire before the fire.' },
  { id: 'e2', kind: 'electric', x: 50, y: 37, label: 'Circuit heat probe', why: 'A circuit running hot behind drywall gives no smoke until it is too late.' },
  { id: 's1', kind: 'smoke', x: 60, y: 13, label: 'Smoke and heat', why: 'The last line of defence, now one voice among many.' },
  { id: 't1', kind: 'structure', x: 40, y: 62, label: 'Slab tilt and strain', why: 'Water that gets into the structure shows up as movement first.' },
];

/** HAVEN, the team of agents that watches the building. Behaviour comes from the HAVEN response rules. */
export const AGENTS = [
  { id: 'guardian', name: 'Guardian', role: 'Keeps watch', voice: 'Calm, first to notice, never cries wolf.', hue: 'g' },
  { id: 'monitor', name: 'Monitor', role: 'Reads every sensor', voice: 'Precise. Talks in trends, not panics.', hue: 'b' },
  { id: 'dispatcher', name: 'Dispatcher', role: 'Gets help moving', voice: 'Decisive. Knows who to call and the way in.', hue: 'a' },
  { id: 'operator', name: 'Operator', role: 'Acts on the building', voice: 'Shuts the valve, cuts the circuit, logs it.', hue: 'p' },
  { id: 'recovery', name: 'Recovery', role: 'Brings it back', voice: 'Patient. Checks that every reading is normal again.', hue: 'r' },
] as const;

export type Audience = 'owner' | 'resident' | 'engineer';
export type Alert = { agent: (typeof AGENTS)[number]['id']; tone: 'info' | 'warn' | 'alert' | 'ok'; text: string; time: string };

export const ALERTS: Record<Audience, Alert[]> = {
  owner: [
    { agent: 'monitor', tone: 'warn', time: '02:14', text: 'Moisture behind the Level 4 riser is up 18% in six hours. Slow, steady, consistent with a pinhole leak.' },
    { agent: 'guardian', tone: 'alert', time: '02:15', text: 'This is a real leak, not condensation. I have opened an incident and paged maintenance.' },
    { agent: 'operator', tone: 'info', time: '02:16', text: 'Isolation valve for the east riser closed. Six units briefly without hot water.' },
    { agent: 'recovery', tone: 'ok', time: '07:40', text: 'Pipe repaired and readings back to normal. Estimated damage avoided: one ceiling and two floors.' },
  ],
  resident: [
    { agent: 'guardian', tone: 'warn', time: '18:02', text: 'Hi Maya, the dryer circuit in 4B is running warmer than usual. Nothing is wrong yet. Could you clean the lint filter tonight?' },
    { agent: 'monitor', tone: 'info', time: '18:40', text: 'Thanks, it is back to its usual temperature. I will keep an eye on it this week.' },
    { agent: 'dispatcher', tone: 'alert', time: '23:11', text: 'Smoke on Level 2. Please leave by the north stairs. The east corridor is closed.' },
    { agent: 'recovery', tone: 'ok', time: '23:58', text: 'All clear. It was a kitchen fire in 2C, now out. You can go back in.' },
  ],
  engineer: [
    { agent: 'monitor', tone: 'warn', time: '09:03', text: 'Panel P-3, breaker 14: arc signature on 3 of the last 5 load cycles. Thermal +11 °C over baseline.' },
    { agent: 'guardian', tone: 'alert', time: '09:04', text: 'Pattern matches a loose neutral. Fire risk rises under evening load. Recommend a fix before 17:00.' },
    { agent: 'dispatcher', tone: 'info', time: '09:06', text: 'Work order WO-2281 sent to the electrician on call. ETA 11:30, panel room access granted.' },
    { agent: 'recovery', tone: 'ok', time: '12:20', text: 'Lug re-torqued. Arc signature gone over 20 cycles. Closing WO-2281.' },
  ],
};
