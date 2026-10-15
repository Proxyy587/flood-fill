import type { SimEvent, SimEventType } from '../../contracts';

/** Colour family of a highlighted event; the map beacon and the incident board share it. */
export type ShowcaseKind = 'alert' | 'water' | 'road' | 'medical' | 'shelter' | 'rescue' | 'air' | 'power' | 'danger';

export const SHOWCASE_COLORS: Record<ShowcaseKind, number> = {
  alert: 0xf5c542,
  water: 0x3fa9f5,
  road: 0xff9f1a,
  medical: 0xff4d6d,
  shelter: 0x2ec27e,
  rescue: 0xff7a1a,
  air: 0x22d3ee,
  power: 0xa78bfa,
  danger: 0xef4444,
};

export const cssColor = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

export interface ShowcaseEntry {
  id: string;
  label: string;
  kind: ShowcaseKind;
  types: SimEventType[];
  /** Extra filter on the event (e.g. one injected kind). */
  match?: (e: SimEvent) => boolean;
  /** Map beacons: every time, only the first few, or at most one per this many ticks. */
  beacon: 'always' | 'never' | { first: number } | { everyTicks: number };
  /** Worth flying the camera to when the auto-director is on. */
  major: boolean;
}

/** The judge-facing checklist, in the order a storm usually unfolds. */
export const SHOWCASE: readonly ShowcaseEntry[] = [
  { id: 'alert', label: 'Flood alert: prone areas named', kind: 'alert', types: ['FLOOD_ALERT'], beacon: 'always', major: true },
  { id: 'waterlog', label: 'Waterlogging hotspot', kind: 'water', types: ['WATERLOGGING'], beacon: 'always', major: true },
  { id: 'roadblock', label: 'Police roadblock + diversion', kind: 'road', types: ['ROADBLOCK'], beacon: 'always', major: true },
  { id: 'injury', label: 'Casualty reported', kind: 'medical', types: ['INJURY_REPORTED'], beacon: 'always', major: true },
  { id: 'ambulance', label: 'Ambulance dispatched', kind: 'medical', types: ['AMBULANCE_DISPATCH'], beacon: { first: 4 }, major: false },
  { id: 'admit', label: 'Patient admitted (beds)', kind: 'medical', types: ['HOSPITAL_ASSIGN', 'HELI_DROPOFF'], match: (e) => e.type === 'HOSPITAL_ASSIGN' || /beds/.test(e.reason), beacon: { first: 3 }, major: false },
  { id: 'divert', label: 'Hospital full / diverting', kind: 'medical', types: ['HOSPITAL_DIVERSION_ON', 'HOSPITAL_DIVERT'], beacon: 'always', major: true },
  { id: 'evac', label: 'Evacuation ordered', kind: 'alert', types: ['EVAC_ORDER'], beacon: 'never', major: false },
  { id: 'camp', label: 'Relief camp opened', kind: 'shelter', types: ['CAMP_OPENED'], beacon: 'always', major: true },
  { id: 'campFull', label: 'Relief camp full', kind: 'shelter', types: ['SHELTER_OVERFLOW'], beacon: 'always', major: false },
  { id: 'boats', label: 'Boat teams released', kind: 'rescue', types: ['TEAMS_DEPLOYED'], beacon: 'always', major: true },
  { id: 'rooftop', label: 'Helicopter rooftop rescue', kind: 'air', types: ['ROOFTOP_RESCUE'], beacon: { everyTicks: 400 }, major: false },
  { id: 'drop', label: 'Helicopter food drop', kind: 'air', types: ['FOOD_DROP'], beacon: 'always', major: true },
  { id: 'grounded', label: 'Helicopters grounded by wind', kind: 'air', types: ['HELI_GROUNDED_WIND'], beacon: 'never', major: false },
  { id: 'power', label: 'Power cut (blackout)', kind: 'power', types: ['POWER_TRIP'], beacon: 'always', major: true },
  { id: 'generator', label: 'Hospital on backup generator', kind: 'power', types: ['GENERATOR_START'], beacon: 'always', major: false },
  { id: 'homes', label: 'Homes flooded', kind: 'water', types: ['HOMES_FLOODED'], beacon: { first: 2 }, major: false },
  { id: 'bridge', label: 'Bridge closed', kind: 'road', types: ['INJECTED', 'BRIDGE_OVERTOPPED'], match: (e) => e.type === 'BRIDGE_OVERTOPPED' || e.data?.kind === 'bridge_closed', beacon: 'always', major: true },
  { id: 'gridlock', label: 'Gridlock', kind: 'road', types: ['GRIDLOCK'], beacon: { first: 1 }, major: false },
  { id: 'landslide', label: 'Landslide on a hill road', kind: 'danger', types: ['LANDSLIDE'], beacon: 'always', major: true },
  { id: 'breach', label: 'Levee breach', kind: 'danger', types: ['LEVEE_BREACH'], beacon: 'always', major: true },
  { id: 'comms', label: 'Phone network down', kind: 'alert', types: ['INJECTED'], match: (e) => e.data?.kind === 'comms_outage', beacon: 'never', major: false },
];

const BY_TYPE = new Map<SimEventType, ShowcaseEntry[]>();
for (const s of SHOWCASE) for (const t of s.types) BY_TYPE.set(t, [...(BY_TYPE.get(t) ?? []), s]);

/** The checklist entry an event counts toward, if any. */
export const showcaseOf = (e: SimEvent): ShowcaseEntry | null => {
  for (const s of BY_TYPE.get(e.type) ?? []) if (!s.match || s.match(e)) return s;
  return null;
};

/** Whether this kind of event can get an on-map callout card (so other surfaces needn't repeat it). */
export const hasCallout = (e: SimEvent): boolean => {
  const entry = showcaseOf(e);
  return !!entry && entry.beacon !== 'never';
};

/** Short card title for a highlighted event. */
export const beaconTitle = (e: SimEvent, entry: ShowcaseEntry): string => {
  const name = typeof e.data?.name === 'string' ? e.data.name : null;
  switch (e.type) {
    case 'WATERLOGGING':
      return `${name ?? 'Street'} waterlogged`;
    case 'ROADBLOCK':
      return `Roadblock: ${name ?? 'road closed'}`;
    case 'LANDSLIDE':
      return `Landslide: ${name ?? 'hill road'}`;
    case 'LEVEE_BREACH':
      return 'Levee breached';
    case 'INJURY_REPORTED':
      return e.reason.startsWith('First') ? 'First casualty reported' : 'Casualty reported';
    case 'FOOD_DROP':
      return 'Food and water drop';
    default:
      return entry.label;
  }
};

/** One line of detail: the reason, trimmed to its first clause. */
export const beaconDetail = (e: SimEvent): string => {
  const first = e.reason.split(/;|\. /)[0];
  return first.length > 96 ? `${first.slice(0, 94)}…` : first;
};
