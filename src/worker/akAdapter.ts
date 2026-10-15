/**
 * Explicit boundary between the UI contract (`src/contracts`) and AK's
 * simulator contract (`src/contracts/ak`). Pure and lossless where both sides
 * can carry a field; every lossy step is reported to the caller.
 */
import {
  NpcState,
  SIM_EVENT_TYPES,
  VehicleKind,
  VehicleState,
  bridgeDeckHeights,
  type BuildingId,
  type InjectedEvent,
  type RenderSnapshot,
  type Scenario,
  type SimEvent,
  type SimEventType,

} from '../contracts';
import * as Ak from '../contracts/ak';

/** UI wind is normalised 0..1; AK templates use m/s. 1.0 ≙ a 30 m/s gale. */
export const WIND_MS_AT_FULL = 30;

/** Injected kinds AK's M3B runner executes; the others throw inside `createSimulation`. */
export const CORE_INJECTABLE: ReadonlySet<InjectedEvent['kind']> = new Set([
  'bridge_closed',
  'road_blocked_by_debris',
  'shelter_overflow',
  'substation_flooded',
  'false_report',
  'comms_outage',
]);

const DEFAULT_FALSE_REPORT_CONFIDENCE = 0.5;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** UI injected event → AK, or a reason it cannot be represented. */
export const injectedToAk = (e: InjectedEvent): { event: Ak.InjectedEvent } | { error: string } => {
  const missing = (field: string) => ({ error: `${e.kind} at tick ${e.t} needs ${field}` });
  switch (e.kind) {
    case 'bridge_closed':
    case 'road_blocked_by_debris':
      return e.cell === undefined ? missing('cell') : { event: { kind: e.kind, tick: e.t, cell: e.cell } };
    case 'boat_failure':
      return e.target === undefined ? missing('target') : { event: { kind: e.kind, tick: e.t, vehicleId: e.target as Ak.VehicleId } };
    case 'shelter_overflow':
      return e.target === undefined ? missing('target') : { event: { kind: e.kind, tick: e.t, buildingId: e.target as Ak.BuildingId } };
    case 'substation_flooded':
      return e.target === undefined ? missing('target (power node id)') : { event: { kind: e.kind, tick: e.t, nodeId: e.target } };
    case 'false_report':
      return e.cell === undefined
        ? missing('cell')
        : { event: { kind: e.kind, tick: e.t, cell: e.cell, confidence: e.confidence ?? DEFAULT_FALSE_REPORT_CONFIDENCE } };
    case 'comms_outage':
      return { event: { kind: e.kind, tick: e.t, durationTicks: Math.max(1, e.durationTicks ?? 300) } };
    case 'helicopter_grounded_wind':
      return {
        event: { kind: e.kind, tick: e.t, speed: (e.speed ?? 1) * WIND_MS_AT_FULL, durationTicks: Math.max(1, e.durationTicks ?? 600) },
      };
    case 'rescue_teams_deployed':
      return { error: 'the core simulator has no boat teams yet, so releasing rescue teams only works on the preview model' };
  }
};

export const injectedFromAk = (e: Ak.InjectedEvent): InjectedEvent => {
  switch (e.kind) {
    case 'bridge_closed':
    case 'road_blocked_by_debris':
      return { kind: e.kind, t: e.tick, cell: e.cell };
    case 'boat_failure':
      return { kind: e.kind, t: e.tick, target: e.vehicleId };
    case 'shelter_overflow':
      return { kind: e.kind, t: e.tick, target: e.buildingId };
    case 'substation_flooded':
      return { kind: e.kind, t: e.tick, target: e.nodeId };
    case 'false_report':
      return { kind: e.kind, t: e.tick, cell: e.cell, confidence: e.confidence };
    case 'comms_outage':
      return { kind: e.kind, t: e.tick, durationTicks: e.durationTicks };
    case 'helicopter_grounded_wind':
      return { kind: e.kind, t: e.tick, speed: clamp01(e.speed / WIND_MS_AT_FULL), durationTicks: e.durationTicks };
  }
};

export interface CoreScenario {
  scenario: Ak.Scenario;
  /** Injected events the core runner cannot execute yet, with the reason. */
  skipped: { event: InjectedEvent; reason: string }[];
}

/**
 * AK requires the entrance inside the footprint; the preview model stores the
 * road cell in front of the door. Pick the footprint cell closest to it.
 */
export const footprintEntrance = (cells: readonly number[], entrance: number, w: number): number => {
  if (cells.includes(entrance)) return entrance;
  const ex = entrance % w;
  const ez = Math.floor(entrance / w);
  let best = cells[0];
  let bestD = Infinity;
  for (const c of cells) {
    const d = Math.abs((c % w) - ex) + Math.abs(Math.floor(c / w) - ez);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
};

/** UI scenario → AK scenario for `createSimulation`. */
export const toCoreScenario = (s: Scenario): CoreScenario => {
  const skipped: CoreScenario['skipped'] = [];
  const injected: Ak.InjectedEvent[] = [];
  for (const e of s.injected) {
    if (!CORE_INJECTABLE.has(e.kind)) {
      skipped.push({ event: e, reason: `${e.kind.replace(/_/g, ' ')} is not modelled by the core simulator yet` });
      continue;
    }
    const r = injectedToAk(e);
    if ('error' in r) skipped.push({ event: e, reason: r.error });
    else injected.push(r.event);
  }
  const explicit = new Map((s.bridges ?? []).map((b) => [b.cell, b.deckHeight]));
  const deck = bridgeDeckHeights(s.size.w, s.size.h, s.ground, s.blocks);
  const bridges: { cell: number; deckHeight: number }[] = [];
  for (let c = 0; c < deck.length; c++) {
    if (deck[c] < 0) continue;
    const h = explicit.get(c) ?? deck[c];
    bridges.push({ cell: c, deckHeight: Math.max(h, s.ground[c] + 1) });
  }
  const { customSchedule, ...population } = s.population;
  return {
    skipped,
    scenario: {
      schemaVersion: 1,
      name: s.name.slice(0, 120),
      size: { ...s.size },
      ground: [...s.ground],
      blocks: [...s.blocks],
      buildings: s.buildings.map((b) => ({ ...b, id: b.id as number as Ak.BuildingId, cells: [...b.cells], entrance: footprintEntrance(b.cells, b.entrance, s.size.w) })),
      ...(bridges.length ? { bridges } : {}),
      districts: s.districts.filter((d) => d.cells.length > 0).map((d) => ({ ...d, cells: [...d.cells] })),
      population: {
        ...population,
        mix: { ...population.mix },
        ...(population.schedule === 'custom' && customSchedule ? { customSchedule: { ...customSchedule } } : {}),
      },
      fleet: { ...s.fleet },
      weather: {
        ...s.weather,
        rain: s.weather.rain.map((p) => ({ ...p })),
        wind: s.weather.wind.map((p) => ({ t: p.t, speed: p.speed * WIND_MS_AT_FULL })),
        sources: s.weather.sources.map((p) => ({ ...p })),
      },
      injected,
      powerGrid: {
        nodes: s.powerGrid.nodes.map((n) => ({ ...n, ...(n.building !== undefined ? { building: n.building as number as Ak.BuildingId } : {}) })),
        edges: s.powerGrid.edges.map(([a, b]) => [a, b] as [number, number]),
      },
      defaults: { ...s.defaults },
    },
  };
};

/** AK scenario (W1 templates) → UI scenario. Lossless: wind is rescaled, not clipped, below 30 m/s. */
export const fromCoreScenario = (s: Ak.Scenario): Scenario => ({
  schemaVersion: 1,
  name: s.name,
  size: { ...s.size },
  ground: [...s.ground],
  blocks: [...s.blocks],
  buildings: s.buildings.map((b) => ({ ...b, id: b.id as number as BuildingId, cells: [...b.cells] })),
  ...(s.bridges ? { bridges: s.bridges.map((b) => ({ ...b })) } : {}),
  districts: s.districts.map((d) => ({ ...d, cells: [...d.cells] })),
  population: { ...s.population, mix: { ...s.population.mix } },
  fleet: { ...s.fleet },
  weather: {
    ...s.weather,
    rain: s.weather.rain.map((p) => ({ ...p })),
    wind: s.weather.wind.map((p) => ({ t: p.t, speed: clamp01(p.speed / WIND_MS_AT_FULL) })),
    sources: s.weather.sources.map((p) => ({ ...p })),
  },
  injected: s.injected.map(injectedFromAk),
  powerGrid: {
    nodes: s.powerGrid.nodes.map((n) => ({ ...n, ...(n.building !== undefined ? { building: n.building as number as BuildingId } : {}) })),
    edges: s.powerGrid.edges.map(([a, b]) => [a, b] as [number, number]),
  },
  defaults: { ...s.defaults },
});

const UI_EVENT_TYPES: ReadonlySet<string> = new Set(SIM_EVENT_TYPES);

/**
 * AK event → UI event. Per-person bookkeeping (`NPC_CREATED`, `ROUTE_PLANNED`,
 * `ARRIVED`, `NPC_STATE`) and run markers have no UI type and are left in the
 * core's own log; the bridge reports run start/finish through status/done.
 */
export const eventFromCore = (e: Ak.SimEvent): SimEvent | null => {
  if (!UI_EVENT_TYPES.has(e.type)) return null;
  return { ...e, type: e.type as SimEventType } as SimEvent;
};

const NPC_STATE: Record<Ak.NpcState, NpcState> = {
  [Ak.NpcState.AtHome]: NpcState.AtHome,
  [Ak.NpcState.Commute]: NpcState.Commuting,
  [Ak.NpcState.Work]: NpcState.Working,
  [Ak.NpcState.ReturnHome]: NpcState.ReturningHome,
  [Ak.NpcState.Warned]: NpcState.Warned,
  [Ak.NpcState.Evacuate]: NpcState.Evacuating,
  [Ak.NpcState.ShelterInPlace]: NpcState.Sheltering,
  [Ak.NpcState.SeekHelp]: NpcState.SeekingHelp,
  [Ak.NpcState.Stranded]: NpcState.Stranded,
  [Ak.NpcState.Respond]: NpcState.OnDuty,
  [Ak.NpcState.Rest]: NpcState.Rescued,
};

export const npcStateFromCore = (s: number): NpcState => NPC_STATE[s as Ak.NpcState] ?? NpcState.Idle;

export const vehicleStateFromCore = (s: number, kind: number): VehicleState => {
  const emergency = kind === VehicleKind.Ambulance || kind === VehicleKind.PoliceCar;
  switch (s as Ak.VehicleState) {
    case Ak.VehicleState.Idle:
      return VehicleState.Parked;
    case Ak.VehicleState.Moving:
      return kind === VehicleKind.Helicopter ? VehicleState.Flying : emergency ? VehicleState.Responding : VehicleState.Driving;
    case Ak.VehicleState.Loading:
      return VehicleState.Responding;
    case Ak.VehicleState.Unloading:
      return VehicleState.Transporting;
    case Ak.VehicleState.Failed:
      return VehicleState.Stalled;
    case Ak.VehicleState.Grounded:
      return VehicleState.Grounded;
    case Ak.VehicleState.Refuelling:
      return kind === VehicleKind.Helicopter ? VehicleState.Landed : VehicleState.Parked;
    default:
      return VehicleState.Parked;
  }
};

/** Piecewise-linear sample of a UI weather timeline. */
export const sampleTimeline = (points: readonly { t: number; v: number }[], tick: number): number => {
  if (!points.length) return 0;
  if (tick <= points[0].t) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (tick <= b.t) return a.v + ((b.v - a.v) * (tick - a.t)) / Math.max(1, b.t - a.t);
  }
  return points[points.length - 1].v;
};

/**
 * AK snapshot → UI snapshot. Copies every array (the core owns its buffers),
 * maps enum columns and adds the UI-only weather and HQ-belief layers.
 */
export const snapshotFromCore = (s: Ak.RenderSnapshot, scenario: Scenario, belief?: Float32Array): RenderSnapshot => {
  const npcState = new Uint8Array(s.npcs.state.length);
  for (let i = 0; i < npcState.length; i++) npcState[i] = npcStateFromCore(s.npcs.state[i]);
  const vehicleState = new Uint8Array(s.vehicles.state.length);
  for (let i = 0; i < vehicleState.length; i++) vehicleState[i] = vehicleStateFromCore(s.vehicles.state[i], s.vehicles.kind[i]);
  const rain = sampleTimeline(scenario.weather.rain.map((p) => ({ t: p.t, v: p.intensity })), s.tick);
  const wind = sampleTimeline(scenario.weather.wind.map((p) => ({ t: p.t, v: p.speed })), s.tick);
  return {
    tick: s.tick,
    water: Float32Array.from(s.water),
    powered: Uint8Array.from(s.powered),
    npcs: {
      id: Int32Array.from(s.npcs.id),
      x: Float32Array.from(s.npcs.x),
      z: Float32Array.from(s.npcs.z),
      heading: Float32Array.from(s.npcs.heading),
      role: Uint8Array.from(s.npcs.role),
      state: npcState,
    },
    vehicles: {
      id: Int32Array.from(s.vehicles.id),
      x: Float32Array.from(s.vehicles.x),
      z: Float32Array.from(s.vehicles.z),
      heading: Float32Array.from(s.vehicles.heading),
      kind: Uint8Array.from(s.vehicles.kind),
      state: vehicleState,
    },
    reports: {
      x: Float32Array.from(s.reports.x),
      z: Float32Array.from(s.reports.z),
      confidence: Float32Array.from(s.reports.confidence),
      status: Uint8Array.from(s.reports.status),
    },
    dirtyChunks: [...s.dirtyChunks],
    weather: { rain: clamp01(rain), wind: clamp01(wind) },
    ...(belief ? { hqBelief: { water: Float32Array.from(belief) } } : {}),
  };
};

