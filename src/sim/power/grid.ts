import { BlockType } from "../../contracts/types";
import type { BuildingId, Scenario, SimEvent } from "../../contracts/types";
import type { World } from "../world/grid";

export function createPowerState(scenario: Scenario) {
  return {
    tripped: new Set<number>(), fuel: new Map<BuildingId, number>(scenario.buildings.map((b) => [b.id, b.generator?.fuelTicks ?? 0])),
    diversion: new Set<BuildingId>(), onGenerator: new Set<BuildingId>(), exhausted: new Set<BuildingId>(),
  };
}
export type PowerState = ReturnType<typeof createPowerState>;

/** Latched trips, undirected physical edges, BFS from every live plant. */
export function stepPower(w: World, scenario: Scenario, state: PowerState, tick: number): SimEvent[] {
  const events: SimEvent[] = []; const previous = w.powered.slice(); const previousDiversion = new Set(state.diversion);
  const emit = (event: Omit<SimEvent, "tick">) => events.push({ tick, ...event });
  for (const node of scenario.powerGrid.nodes) {
    if ((node.kind === "substation" || node.kind === "plant") && w.water[node.cell] > 0.5 && !state.tripped.has(node.id)) {
      state.tripped.add(node.id);
      emit({ type: "POWER_TRIP", cell: node.cell, data: { nodeId: node.id }, reason: `Power node ${node.id} tripped: depth ${w.water[node.cell].toFixed(3)}m exceeds 0.5m` });
    }
  }
  const adjacency = new Map<number, number[]>(scenario.powerGrid.nodes.map((n) => [n.id, []]));
  for (const [a, b] of scenario.powerGrid.edges) { adjacency.get(a)!.push(b); adjacency.get(b)!.push(a); }
  const live = new Set<number>(); const queue: number[] = [];
  for (const node of scenario.powerGrid.nodes) if (node.kind === "plant" && !state.tripped.has(node.id)) { live.add(node.id); queue.push(node.id); }
  for (let index = 0; index < queue.length; index++) for (const next of adjacency.get(queue[index]) ?? []) {
    if (!state.tripped.has(next) && !live.has(next)) { live.add(next); queue.push(next); }
  }
  w.powered.fill(0); state.diversion.clear();
  for (const node of scenario.powerGrid.nodes) if (live.has(node.id)) w.powered[node.cell] = 1;
  for (const b of scenario.buildings) {
    const flooded = b.cells.some((cell) => w.water[cell] > b.floorHeight);
    const grid = b.powerNode !== undefined && live.has(b.powerNode);
    let powered = grid ? 1 : 0;
    const remaining = state.fuel.get(b.id) ?? 0;
    if (b.type === BlockType.Hospital && (b.generator?.fuelTicks ?? 0) > 0 && remaining === 0 && !state.exhausted.has(b.id)) {
      state.exhausted.add(b.id);
      emit({ type: "GENERATOR_EXHAUSTED", actor: b.id, reason: "Backup fuel exhausted; generator unavailable" });
    }
    if (b.type === BlockType.Hospital && !grid && !flooded) {
      if (remaining > 0) {
        powered = 2; state.fuel.set(b.id, remaining - 1);
        if (!state.onGenerator.has(b.id)) emit({ type: "GENERATOR_START", actor: b.id, cell: b.entrance, reason: "Grid power unavailable; hospital backup generator started" });
        state.onGenerator.add(b.id);
        if (remaining === 1) emit({ type: "GENERATOR_FUEL_LOW", actor: b.id, reason: "Generator has one tick of fuel remaining" });
      }
    }
    if (powered !== 2) state.onGenerator.delete(b.id);
    for (const cell of b.cells) w.powered[cell] = powered;
    if (b.type === BlockType.Hospital && (flooded || powered === 0)) {
      state.diversion.add(b.id);
      if (!previousDiversion.has(b.id)) emit({ type: "HOSPITAL_DIVERSION_ON", actor: b.id, reason: flooded ? "Hospital interior flooded" : "Hospital has neither grid power nor active backup" });
    }
  }
  const lost: number[] = []; const restored: number[] = [];
  for (let cell = 0; cell < w.powered.length; cell++) {
    if (previous[cell] > 0 && w.powered[cell] === 0) lost.push(cell);
    if (previous[cell] === 0 && w.powered[cell] > 0) restored.push(cell);
  }
  if (lost.length > 0) emit({ type: "BLACKOUT_ZONE", cell: lost[0], data: { cells: lost.length }, reason: `${lost.length} cells lost their last power source` });
  if (tick > 0 && restored.length > 0) emit({ type: "POWER_RESTORED", cell: restored[0], data: { cells: restored.length }, reason: "Electrical service restored through grid or local backup" });
  return events;
}
