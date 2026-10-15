import { BlockType } from "../contracts/types";
import { z } from "zod";
import type { Scenario, DispatchMode, RunOptions, RenderSnapshot, MetricsFrame, RunSummary, SimEvent } from "../contracts/types";
import { DispatchModeSchema, RunOptionsSchema, ScenarioSchema, SeedSchema } from "../contracts/schemas";
import { createRng } from "./rng";
import { createWorld } from "./world/grid";
import { sampleTimeline } from "./weather/timeline";
import { stepFlood } from "./flood/solver";
import { createPowerState, stepPower } from "./power/grid";

export const FOUNDATION_CAPABILITIES = { weather: true, flood: true, power: true, agents: false, dispatch: false, aircraft: false } as const;

/** Same core API for Node batch execution and AJ's browser worker adapter. */
export function createSimulation(input: Scenario, seedInput: number, modeInput: DispatchMode, options: RunOptions = {}) {
  const scenario = ScenarioSchema.parse(input); const seed = SeedSchema.parse(seedInput);
  const mode = DispatchModeSchema.parse(modeInput); const parsed = RunOptionsSchema.parse(options);
  const duration = parsed.durationTicks ?? 600; const every = parsed.metricsEvery ?? 10;
  for (const event of scenario.injected) if (event.kind !== "substation_flooded") throw new Error(`Injected action ${event.kind} not implemented in foundation runner`);
  const world = createWorld(scenario); const power = createPowerState(scenario);
  const rng = createRng(seed); // Run-scoped stream, reserved for per-agent randomness in M1.
  const events: SimEvent[] = [{ tick: 0, type: "RUN_STARTED", data: { stage: "foundation", seed, dispatchImplemented: false }, reason: "Foundation run: weather, flood and power are implemented; agent/dispatch/aircraft metrics are unavailable" }];
  const frames: MetricsFrame[] = [];
  let tick = 0; let navVersion = 0; let lastRain = -1; let lastWind = -1;
  function applyScheduled(boundary: number) {
    for (const event of scenario.injected) if (event.tick === boundary && event.kind === "substation_flooded") {
      events.push({ tick: boundary, type: "INJECTED", data: { kind: event.kind, nodeId: event.nodeId }, reason: "Scheduled synthetic substation flood fault" });
      if (!power.tripped.has(event.nodeId)) {
        power.tripped.add(event.nodeId);
        events.push({ tick: boundary, type: "POWER_TRIP", data: { nodeId: event.nodeId }, reason: "Substation latched off by injected flood fault" });
      }
    }
  }
  applyScheduled(0);
  events.push(...stepPower(world, scenario, power, 0));
  const closed = new Uint8Array(world.water.length);

  function metrics(): MetricsFrame {
    let floodedCells = 0; let maxDepth = 0;
    for (const depth of world.water) { if (depth > 0.01) floodedCells++; maxDepth = Math.max(maxDepth, depth); }
    const homes = scenario.buildings.filter((b) => b.type === BlockType.House || b.type === BlockType.Apartment);
    const totalCapacity = homes.reduce((sum, b) => sum + b.capacity, 0);
    const unpoweredCapacity = homes.reduce((sum, b) => sum + (world.powered[b.entrance] === 0 ? b.capacity : 0), 0);
    return { tick, tts: { mean: 0, p50: 0, p90: 0 }, unmet: 0, idleFrac: {}, gini: 0,
      hospitals: scenario.buildings.filter((b) => b.type === BlockType.Hospital).map((b) => ({ id: b.id, util: 0, diversion: power.diversion.has(b.id), onGenerator: world.powered[b.entrance] === 2 })),
      evacDonePct: 0, stranded: 0, gridlockCells: 0, floodedCells, maxDepth,
      unpoweredPopPct: totalCapacity > 0 ? unpoweredCapacity / totalCapacity * 100 : 0,
      heliRescues: 0, routeViolations: 0 };
  }
  frames.push(metrics());
  function snapshot(): RenderSnapshot {
    return { tick, water: world.water.slice(), powered: world.powered.slice(),
      npcs: { id: new Int32Array(), x: new Float32Array(), z: new Float32Array(), heading: new Float32Array(), role: new Uint8Array(), state: new Uint8Array() },
      vehicles: { id: new Int32Array(), x: new Float32Array(), z: new Float32Array(), heading: new Float32Array(), kind: new Uint8Array(), state: new Uint8Array() },
      reports: { x: new Float32Array(), z: new Float32Array(), confidence: new Float32Array(), status: new Uint8Array() },
      dirtyChunks: tick === 0 ? Array.from({ length: Math.ceil(world.width / 16) * Math.ceil(world.height / 16) }, (_, i) => i) : [] };
  }
  function summary(): RunSummary {
    return structuredClone({ scenario: scenario.name, seed, mode, metrics: frames, events, hotspots: [] });
  }
  return {
    get tick() { return tick; }, get done() { return tick >= duration; }, get navVersion() { return navVersion; },
    rng, snapshot, summary,
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
      for (let cell = 0; cell < world.water.length; cell++) {
        if (world.block[cell] !== BlockType.Road && world.block[cell] !== BlockType.Bridge) continue;
        const isClosed = world.water[cell] > 0.3 ? 1 : 0;
        if (isClosed !== closed[cell]) {
          closed[cell] = isClosed; navVersion++;
          events.push({ tick: tick + 1, type: isClosed ? "ROAD_CLOSED" : "ROAD_REOPENED", cell, data: { navVersion }, reason: `Depth ${world.water[cell].toFixed(3)}m ${isClosed ? "exceeds" : "is within"} car limit 0.3m` });
        }
      }
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
