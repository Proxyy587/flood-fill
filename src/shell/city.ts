import { create } from 'zustand';
import { BlockType, type Scenario, type SimEvent, type SimEventType } from '../contracts';
import { mockBuildingNames } from '../contracts/mocks';
import { useSceneStore, type MapLabel } from '../bridge/sceneStore';
import { LANDMARK_CATEGORY } from '../render/overlays/LandmarkHalos';

export const blockName = (b: number): string => (BlockType[b] ?? 'Ground').replace(/([a-z])([A-Z])/g, '$1 $2');

interface CityState {
  /** Building id → display name. */
  names: Record<number, string>;
}

export const useCityStore = create<CityState>()(() => ({ names: {} }));

/** Building names and map labels (district names, civic pins) for a scenario. */
export const describeCity = (scenario: Scenario): { names: Record<number, string>; labels: MapLabel[] } => {
  const w = scenario.size.w;
  const list = mockBuildingNames(scenario);
  const names: Record<number, string> = {};
  scenario.buildings.forEach((b, i) => (names[b.id] = list[i] ?? `${blockName(b.type)} #${b.id}`));

  const labels: MapLabel[] = [];
  for (const d of scenario.districts) {
    if (!d.cells.length) continue;
    let sx = 0;
    let sz = 0;
    for (const c of d.cells) {
      sx += c % w;
      sz += Math.floor(c / w);
    }
    const cx = sx / d.cells.length;
    const cz = sz / d.cells.length;
    let best = d.cells[0];
    let bestD = Infinity;
    for (const c of d.cells) {
      const dd = ((c % w) - cx) ** 2 + (Math.floor(c / w) - cz) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = c;
      }
    }
    labels.push({ key: `d${d.id}`, text: d.name, x: (best % w) + 0.5, z: Math.floor(best / w) + 0.5, kind: 'district' });
  }
  for (const b of scenario.buildings) {
    const category = LANDMARK_CATEGORY[b.type];
    if (!category) continue;
    const c = b.cells[0];
    labels.push({ key: `b${b.id}`, text: names[b.id], x: (c % w) + 0.5, z: Math.floor(c / w) + 0.5, kind: 'landmark', category, building: b.id });
  }
  return { names, labels };
};

export type Tone = 'info' | 'warn' | 'bad' | 'good';

/** Plain-language headlines for the events people should notice. */
export const HEADLINES: Partial<Record<SimEventType, { title: string; tone: Tone }>> = {
  WEATHER: { title: 'Weather update', tone: 'info' },
  FLOOD_THRESHOLD: { title: 'Flooding spreads', tone: 'warn' },
  LOCAL_FLOOD: { title: 'Street flooding', tone: 'warn' },
  BRIDGE_OVERTOPPED: { title: 'Bridge closed', tone: 'bad' },
  EVAC_ORDER: { title: 'Evacuation ordered', tone: 'warn' },
  POWER_TRIP: { title: 'Substation tripped', tone: 'bad' },
  POWER_RESTORED: { title: 'Power restored', tone: 'good' },
  GENERATOR_START: { title: 'Hospital on backup power', tone: 'warn' },
  GENERATOR_FUEL_LOW: { title: 'Generator fuel low', tone: 'warn' },
  GENERATOR_EXHAUSTED: { title: 'Hospital lost power', tone: 'bad' },
  HOSPITAL_DIVERSION_ON: { title: 'Hospital diverting patients', tone: 'bad' },
  SHELTER_OVERFLOW: { title: 'Shelter full', tone: 'bad' },
  HELI_GROUNDED_WIND: { title: 'Helicopters grounded by wind', tone: 'warn' },
  GRIDLOCK: { title: 'Gridlock', tone: 'warn' },
  DRAIN_BACKFLOW: { title: 'Drains backing up', tone: 'warn' },
  HOMES_FLOODED: { title: 'Homes flooded', tone: 'bad' },
  TEAMS_DEPLOYED: { title: 'Rescue teams released', tone: 'good' },
  FLOOD_ALERT: { title: 'Flood alert issued', tone: 'warn' },
  WATERLOGGING: { title: 'Waterlogging', tone: 'warn' },
  ROADBLOCK: { title: 'Road sealed by police', tone: 'warn' },
  INJURY_REPORTED: { title: 'Casualty reported', tone: 'bad' },
  AMBULANCE_DISPATCH: { title: 'Ambulance dispatched', tone: 'info' },
  FOOD_DROP: { title: 'Food drop', tone: 'good' },
  LEVEE_BREACH: { title: 'Levee breached', tone: 'bad' },
  LANDSLIDE: { title: 'Landslide', tone: 'bad' },
  CAMP_OPENED: { title: 'Relief camp opened', tone: 'good' },
  INJECTED: { title: 'Stress event injected', tone: 'info' },
  INVARIANT_VIOLATION: { title: 'Safety rule broken', tone: 'bad' },
};

/** Event groups for the log filter. */
export const EVENT_GROUPS: { id: string; label: string; types: SimEventType[] }[] = [
  {
    id: 'water',
    label: 'Water',
    types: ['WEATHER', 'FLOOD_ALERT', 'FLOOD_THRESHOLD', 'LOCAL_FLOOD', 'WATERLOGGING', 'DRAIN_BACKFLOW', 'HOMES_FLOODED', 'LEVEE_BREACH', 'LANDSLIDE', 'ROAD_CLOSED', 'ROADBLOCK', 'ROAD_REOPENED', 'BRIDGE_OVERTOPPED', 'EVAC_ORDER', 'GRIDLOCK'],
  },
  { id: 'power', label: 'Power', types: ['POWER_TRIP', 'POWER_RESTORED', 'BLACKOUT_ZONE', 'GENERATOR_START', 'GENERATOR_FUEL_LOW', 'GENERATOR_EXHAUSTED', 'SIGNAL_DARK'] },
  {
    id: 'rescue',
    label: 'Rescue',
    types: [
      'TEAMS_DEPLOYED',
      'NPC_STRANDED',
      'INJURY_REPORTED',
      'AMBULANCE_DISPATCH',
      'REQUEST_CREATED',
      'ASSIGNED',
      'SERVED',
      'CAMP_OPENED',
      'FOOD_DROP',
      'HELI_DISPATCH',
      'HELI_PICKUP',
      'HELI_DROPOFF',
      'ROOFTOP_RESCUE',
      'MEDEVAC',
      'HELI_GROUNDED',
      'HELI_GROUNDED_WIND',
    ],
  },
  { id: 'dispatch', label: 'Decisions', types: ['BID', 'COMMIT_CANCELLED', 'REROUTE', 'HOSPITAL_ASSIGN', 'HOSPITAL_DIVERT', 'HOSPITAL_DIVERSION_ON', 'REPORT_CREATED', 'REPORT_VERIFIED', 'REPORT_FALSE'] },
];

export const eventTitle = (e: SimEvent): string => HEADLINES[e.type]?.title ?? e.type.charAt(0) + e.type.slice(1).toLowerCase().replace(/_/g, ' ');

export const formatTimeOfDay = (seconds: number): string => {
  const s = ((seconds % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
};

/** Simulated clock for a tick of the loaded run (which starts at the run's chosen time). */
export const clockOf = (tick: number): string => formatTimeOfDay(useSceneStore.getState().startSeconds + tick);

export const elapsed = (tick: number): string => {
  const m = Math.floor(tick / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};
