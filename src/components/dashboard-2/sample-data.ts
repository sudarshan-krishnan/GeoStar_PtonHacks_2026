import { Building2, Cpu, Store, Sun, Trees, Wind } from 'lucide-react';

// Interface fixtures only. These values are not property listings or analysis results.
export const sampleProjectTypes = [
  {
    id: 'data-center',
    label: 'Data center',
    icon: Cpu,
    detail: 'Infrastructure for what’s next',
    brief:
      'A 20 MW data center in Houston, with room to grow and a thoughtful approach to energy, water and the surrounding community.',
  },
  {
    id: 'wind',
    label: 'Wind farm',
    icon: Wind,
    detail: 'A new direction for energy',
    brief:
      'A wind energy project near Houston with open land, grid access and a considered relationship with neighboring communities.',
  },
  {
    id: 'solar',
    label: 'Solar farm',
    icon: Sun,
    detail: 'Make more of every day',
    brief:
      'A solar energy project near Houston with space for panels, access to the grid and room for the landscape to thrive.',
  },
  {
    id: 'residential',
    label: 'Student living',
    icon: Building2,
    detail: 'A place to feel at home',
    brief:
      'Student housing for 200 residents, close to campus, everyday essentials and a walkable neighborhood.',
  },
  {
    id: 'park',
    label: 'Community park',
    icon: Trees,
    detail: 'Bring people together',
    brief:
      'A community park with welcoming green space, walking paths and room for neighbors to gather.',
  },
  {
    id: 'commercial',
    label: 'Commercial',
    icon: Store,
    detail: 'Give a business its place',
    brief:
      'A commercial development with convenient access, flexible space and a strong connection to the neighborhood.',
  },
] as const;

export const sampleSites = [
  {
    id: 'northline',
    letter: 'A',
    name: 'Northline Campus',
    area: 'Northwest district',
    acres: '18.4',
    price: '$4.8M',
    score: 92,
    x: 31,
    y: 33,
    tag: 'Top match',
    note: 'Room to grow. A quieter edge of the city, with an established infrastructure corridor nearby.',
    money: 89,
    people: 94,
    planet: 92,
    access: '1.2 mi',
    water: 'Low',
    context: 'A generous footprint with space for landscape buffers and future expansion.',
  },
  {
    id: 'eastpoint',
    letter: 'B',
    name: 'Eastpoint Commons',
    area: 'Eastern district',
    acres: '12.6',
    price: '$3.2M',
    score: 87,
    x: 73,
    y: 37,
    tag: 'Strong potential',
    note: 'An accessible location with a smaller footprint and established connections to the city.',
    money: 92,
    people: 84,
    planet: 85,
    access: '2.1 mi',
    water: 'Moderate',
    context: 'A compact site close to existing roads and services.',
  },
  {
    id: 'bayou',
    letter: 'C',
    name: 'Bayou District',
    area: 'Southern district',
    acres: '22.1',
    price: '$5.6M',
    score: 84,
    x: 58,
    y: 75,
    tag: 'More to explore',
    note: 'Open space and a landscape-led setting. Water and site conditions deserve a closer look.',
    money: 82,
    people: 88,
    planet: 81,
    access: '3.4 mi',
    water: 'Review',
    context: 'A larger landscape with an opportunity for careful, sensitive planning.',
  },
  {
    id: 'westloop',
    letter: 'D',
    name: 'West Loop Works',
    area: 'Western district',
    acres: '9.8',
    price: '$2.9M',
    score: 81,
    x: 16,
    y: 68,
    tag: 'Compact opportunity',
    note: 'A connected urban setting, suited to a focused project with a compact footprint.',
    money: 88,
    people: 78,
    planet: 77,
    access: '0.8 mi',
    water: 'Low',
    context: 'A smaller parcel with convenient access and less room for expansion.',
  },
] as const;

export type PreviewProjectType = (typeof sampleProjectTypes)[number]['id'];
export type SampleSite = (typeof sampleSites)[number];
