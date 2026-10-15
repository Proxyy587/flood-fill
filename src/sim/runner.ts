import { BlockType, NpcState, VehicleState } from "../contracts/types";
import { z } from "zod";
import type { Scenario, DispatchMode, RunOptions, RenderSnapshot, MetricsFrame, RunSummary, SimEvent, EntitySelection } from "../contracts/types";
import { DispatchModeSchema, RunOptionsSchema, ScenarioSchema, SeedSchema } from "../contracts/schemas";
import { createRng } from "./rng";
import { createWorld } from "./world/grid";
import { sampleTimeline } from "./weather/timeline";
import { stepFlood } from "./flood/solver";
import { createPowerState, stepPower } from "./power/grid";
import { createPopulation } from "./agents/population";
import { createAgentSystem, stepAgents, agentSnapshot, inspectAgent } from "./agents/system";
import { createTraffic, gridlockCells } from "./traffic";
import { canEnter } from "./nav/hazards";

export const SIM_CAPABILITIES = { weather: true, flood: true, power: true, agents: true, commuting: true, traffic: true, evacuation: false, reports: false, dispatch: false, aircraft: false } as const;
/** Compatibility alias for existing headless clients. */
export const FOUNDATION_CAPABILITIES = SIM_CAPABILITIES;

/** Same core API for Node batch execution and AJ's browser worker adapter. */
export function createSimulation(input: Scenario, seedInput: number, modeInput: DispatchMode, options: RunOptions = {}) {
  const scenario = ScenarioSchema.parse(input); const seed = SeedSchema.parse(seedInput);
  const mode = DispatchModeSchema.parse(modeInput); const parsed = RunOptionsSchema.parse(options);
  const duration = parsed.durationTicks ?? 600; const every = parsed.metricsEvery ?? 10;
  for (const event of scenario.injected) {
    if (event.kind !== "substation_flooded" && event.kind !== "bridge_closed" && event.kind !== "road_blocked_by_debris") throw new Error(`Injected action ${event.kind} not implemented in living-city runner`);
    if (event.kind === "bridge_closed" && scenario.blocks[event.cell] !== BlockType.Bridge) throw new Error("bridge_closed requires a bridge cell");
    if (event.kind === "road_blocked_by_debris" && scenario.blocks[event.cell] !== BlockType.Road && scenario.blocks[event.cell] !== BlockType.Bridge) throw new Error("road_blocked_by_debris requires a road or bridge cell");
  }
  const world = createWorld(scenario); const power = createPowerState(scenario);
  const rng = createRng(seed);
  const events: SimEvent[] = [{ tick: 0, type: "RUN_STARTED", data: { stage: "living-city", seed, agentsImplemented: true, dispatchImplemented: false }, reason: "Weather, flood, power, commuting and traffic implemented; evacuation, reports, dispatch, aircraft and response metrics remain unavailable" }];
  const frames: MetricsFrame[] = [];
  let tick = 0; let navVersion = 0; let lastRain = -1; let lastWind = -1;
  const blocked = new Uint8Array(world.water.length);
  const closed = new Uint8Array(world.water.length);
  function applyScheduled(boundary: number) {
    for (const event of scenario.injected) if (event.tick === boundary) {
      if (event.kind === "bridge_closed" || event.kind === "road_blocked_by_debris") {
        blocked[event.cell] = 1;
        events.push({ tick: boundary, type: "INJECTED", cell: event.cell, data: { kind: event.kind }, reason: "Scheduled synthetic permanent road closure" });
      } else if (event.kind === "substation_flooded") {
      events.push({ tick: boundary, type: "INJECTED", data: { kind: event.kind, nodeId: event.nodeId }, reason: "Scheduled synthetic substation flood fault" });
      if (!power.tripped.has(event.nodeId)) {
        power.tripped.add(event.nodeId);
        events.push({ tick: boundary, type: "POWER_TRIP", data: { nodeId: event.nodeId }, reason: "Substation latched off by injected flood fault" });
      }
      }
    }
  }
  function updateClosures(boundary: number) {
    for (let cell = 0; cell < world.water.length; cell++) {
      if (world.block[cell] !== BlockType.Road && world.block[cell] !== BlockType.Bridge) continue;
      const isClosed = canEnter(world, scenario, "car", cell, blocked) ? 0 : 1;
      if (isClosed !== closed[cell]) {
        closed[cell] = isClosed; navVersion++;
        events.push({ tick: boundary, type: isClosed ? "ROAD_CLOSED" : "ROAD_REOPENED", cell, data: { navVersion }, reason: isClosed ? "Car road unavailable due to depth, bridge overtopping or explicit closure" : "Car road reopened within its operating limits" });
      }
    }
  }
  applyScheduled(0);
  events.push(...stepPower(world, scenario, power, 0));
  updateClosures(0);
  const population = createPopulation(scenario, seed, parsed);
  const agents = createAgentSystem(population, world, scenario);
  const traffic = createTraffic(world);
  events.push(...population.events);

  function metrics(): MetricsFrame {
    let floodedCells = 0; let maxDepth = 0;
    for (const depth of world.water) { if (depth > 0.01) floodedCells++; maxDepth = Math.max(maxDepth, depth); }
    let stranded = 0; let unpowered = 0; let idle = 0;
    for (let i = 0; i < population.npcs.id.length; i++) {
      if (population.npcs.state[i] === NpcState.SeekHelp || population.npcs.state[i] === NpcState.Stranded) stranded++;
      if (world.powered[population.npcs.cell[i]] === 0) unpowered++;
    }
    for (const state of population.cars.state) if (state === VehicleState.Idle) idle++;
    return { tick, tts: { mean: 0, p50: 0, p90: 0 }, unmet: 0, idleFrac: population.cars.id.length ? { car: idle / population.cars.id.length } : {}, gini: 0,
      hospitals: scenario.buildings.filter((b) => b.type === BlockType.Hospital).map((b) => ({ id: b.id, util: 0, diversion: power.diversion.has(b.id), onGenerator: world.powered[b.entrance] === 2 })),
      evacDonePct: 0, stranded, gridlockCells: gridlockCells(traffic), floodedCells, maxDepth,
      unpoweredPopPct: population.npcs.id.length ? unpowered / population.npcs.id.length * 100 : 0,
      heliRescues: 0, routeViolations: 0 };
  }
  frames.push(metrics());
  function snapshot(): RenderSnapshot {
    return { tick, water: world.water.slice(), powered: world.powered.slice(),
      ...agentSnapshot(agents),
      reports: { x: new Float32Array(), z: new Float32Array(), confidence: new Float32Array(), status: new Uint8Array() },
      dirtyChunks: tick === 0 ? Array.from({ length: Math.ceil(world.width / 16) * Math.ceil(world.height / 16) }, (_, i) => i) : [] };
  }
  function summary(): RunSummary {
    return structuredClone({ scenario: scenario.name, seed, mode, metrics: frames, events, hotspots: [] });
  }
  return {
    get tick() { return tick; }, get done() { return tick >= duration; }, get navVersion() { return navVersion; },
    rng, snapshot, summary, inspect: (selection: EntitySelection) => inspectAgent(agents, selection),
    step() {
      if (tick >= duration) throw new Error("Run has already finished");
      // Sources/timelines sample the interval beginning at tick. Result state is tick+1.
      const rain = sampleTimeline(scenario.weather.rain.map((p) => ({ t: p.t, value: p.intensity })), tick);
      const wind = sampleTimeline(scenario.weather.wind.map((p) => ({ t: p.t, value: p.speed })), tick);
      if (rain !== lastRain || wind !== lastWind) events.push({ tick, type: "WEATHER", data: { rain, wind }, reason: `Rain intensity ${rain.toFixed(3)}, wind ${wind.toFixed(3)}m/s` });
      lastRain = rain; lastWind = wind;
      stepFlood(world, { rain: rain * 0.002, sources: scenario.weather.sources, tick });
      applyScheduled(tick + 1);
      events.push(...stepPower(world, scenario, power, tick + 1));
      updateClosures(tick + 1);
      events.push(...stepAgents(agents, world, scenario, tick + 1, blocked, traffic));
      tick++;
      if (tick % every === 0 || tick === duration) frames.push(metrics());
      if (tick === duration) events.push({ tick, type: "RUN_FINISHED", reason: `Completed ${duration} deterministic simulation seconds` });
    },
  };
}

export function runBatch(scenario: Scenario, seeds: readonly number[], mode: DispatchMode, options: RunOptions = {}): RunSummary[] {
  // Validate even an empty seed list so invalid input cannot silently pass.
  ScenarioSchema.parse(scenario); DispatchModeSchema.parse(mode); RunOptionsSchema.parse(options);
  const validatedSeeds = z.array(SeedSchema).max(1000).parse(seeds);
  return validatedSeeds.map((seed) => {
    const simulation = createSimulation(scenario, seed, mode, options);
    while (!simulation.done) simulation.step();
    return simulation.summary();
  });
}
