import type { InspectorData as UiInspector, Scenario as UiScenario, SimEvent as UiEvent, RenderSnapshot as UiSnapshot, RunSummary as UiSummary, WorldSnapshot } from '../contracts';
import type { BuildingId, InjectedEvent as AkInjectedEvent, InspectorData as AkInspector, Scenario as AkScenario, SimEvent as AkEvent, RenderSnapshot as AkSnapshot, RunSummary as AkSummary, VehicleId } from '../contracts/types';
import { CHUNK_SIZE } from '../contracts';
import { sampleTimeline } from '../sim/weather/timeline';

/** Translate the frozen UI injection shape to AK runner's internal scenario shape. */
export function toAkInjected(event: UiScenario['injected'][number]): AkInjectedEvent {
  switch (event.kind) {
    case 'bridge_closed':
    case 'road_blocked_by_debris':
      if (event.cell === undefined) throw new Error(`${event.kind} requires a cell.`);
      return { kind: event.kind, tick: event.t, cell: event.cell };
    case 'boat_failure':
      if (event.target === undefined) throw new Error('boat_failure requires a vehicle target.');
      return { kind: event.kind, tick: event.t, vehicleId: event.target as VehicleId };
    case 'shelter_overflow':
      if (event.target === undefined) throw new Error('shelter_overflow requires a building target.');
      return { kind: event.kind, tick: event.t, buildingId: (event.target + 1) as BuildingId };
    case 'substation_flooded':
      if (event.target === undefined) throw new Error('substation_flooded requires a power-node target.');
      return { kind: event.kind, tick: event.t, nodeId: event.target };
    case 'false_report':
      if (event.cell === undefined) throw new Error('false_report requires a cell.');
      return { kind: event.kind, tick: event.t, cell: event.cell, confidence: 0.5 };
    case 'comms_outage':
      return { kind: event.kind, tick: event.t, durationTicks: event.durationTicks ?? 0 };
    case 'helicopter_grounded_wind':
      throw new Error('helicopter_grounded_wind is not supported by the current AK simulation runner.');
    case 'rescue_teams_deployed':
      throw new Error('rescue_teams_deployed is not supported by the current AK simulation runner.');
  }
}

/** Convert the UI scenario to the compatible AK runner API without changing shared contracts. */
export function toAkScenario(scenario: UiScenario): AkScenario {
  const converted = {
    schemaVersion: scenario.schemaVersion,
    name: scenario.name,
    size: scenario.size,
    ground: scenario.ground,
    blocks: scenario.blocks,
    buildings: scenario.buildings.map((building) => ({ ...building, id: (building.id + 1) as BuildingId })),
    districts: scenario.districts,
    population: scenario.population,
    fleet: scenario.fleet,
    weather: scenario.weather,
    injected: scenario.injected.map(toAkInjected),
    powerGrid: {
      ...scenario.powerGrid,
      nodes: scenario.powerGrid.nodes.map((node) => ({ ...node, ...(node.building === undefined ? {} : { building: (node.building + 1) as BuildingId }) })),
    },
    defaults: scenario.defaults,
  };
  return converted as unknown as AkScenario;
}

/** Build renderer world layers from the validated scenario at load/edit boundaries. */
export function toWorldSnapshot(scenario: UiScenario): WorldSnapshot {
  const { w, h } = scenario.size;
  const buildingIndex = new Uint16Array(w * h);
  for (const building of scenario.buildings) {
    for (const cell of building.cells) buildingIndex[cell] = building.id + 1;
  }
  const chunkCountX = Math.ceil(w / CHUNK_SIZE);
  const chunkCountZ = Math.ceil(h / CHUNK_SIZE);
  return {
    w,
    h,
    ground: Uint8Array.from(scenario.ground),
    blocks: Uint8Array.from(scenario.blocks),
    buildingIndex,
    dirtyChunks: Array.from({ length: chunkCountX * chunkCountZ }, (_, index) => index),
  };
}

/** Add renderer-only weather values omitted by AK's pure snapshot. */
export function toUiSnapshot(snapshot: AkSnapshot, scenario: UiScenario): UiSnapshot {
  const rain = sampleTimeline(scenario.weather.rain.map(({ t, intensity }) => ({ t, value: intensity })), snapshot.tick);
  const wind = sampleTimeline(scenario.weather.wind.map(({ t, speed }) => ({ t, value: speed })), snapshot.tick);
  return { ...snapshot, weather: { rain, wind } } as unknown as UiSnapshot;
}

/** Map AK's translated positive building IDs back to the original UI document IDs. */
export function toUiEvent(event: AkEvent): UiEvent {
  return {
    ...event,
    ...(event.actorKind === 'building' && event.actor !== undefined ? { actor: (event.actor - 1) as UiEvent['actor'] } : {}),
    ...(event.targetKind === 'building' && event.target !== undefined ? { target: (event.target - 1) as UiEvent['target'] } : {}),
  } as UiEvent;
}

export function toUiSummary(summary: AkSummary): UiSummary {
  return {
    ...summary,
    events: summary.events.map(toUiEvent),
    metrics: summary.metrics.map(toUiMetricsFrame),
  } as UiSummary;
}

export function toUiMetricsFrame(frame: AkSummary['metrics'][number]): UiSummary['metrics'][number] {
  return {
    ...frame,
    hospitals: frame.hospitals.map((hospital) => ({ ...hospital, id: (hospital.id - 1) as UiSummary['metrics'][number]['hospitals'][number]['id'] })),
  };
}

export function toAkInspectorSelection(ref: { id: number; kind: 'npc' | 'vehicle' | 'building' | 'cell' }) {
  return { ...ref, id: ref.kind === 'building' ? ref.id + 1 : ref.id };
}

export function toUiInspector(inspector: AkInspector | null): UiInspector | null {
  if (!inspector) return null;
  return { ...inspector, id: inspector.kind === 'building' ? inspector.id - 1 : inspector.id } as UiInspector;
}
