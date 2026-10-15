import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { BlockType, RenderSnapshotSchema, RunSummarySchema, VehicleKind, VehicleState } from "../src/contracts";
import { createSimulation, runBatch } from "../src/sim";
import { livingFixture } from "../src/sim/agents/living-fixture";
import { defaultNpcParams } from "../src/sim/agents/population";

// Synthetic throughput probes, not the five-failure rescue stress scenario.
const results = [];
for (const count of [12, 1000, 10000]) {
  const s = livingFixture();
  s.name = `MOCK living health ${count}`;
  s.population = { count, mix: { carOwners: 0.3, limitedMobility: 0.1, needsAssist: 0.1 }, schedule: "custom", customSchedule: { departAt: 0, workTicks: 5 } };
  s.fleet = { ambulances: count === 10000 ? 7 : 0, policeCars: 0, boats: 0, helicopters: 0, doctors: 0, nurses: 0, policeOfficers: 0, boatOperators: 0 };
  s.buildings[0].capacity = count; s.buildings[2].capacity = count;
  s.weather.sources = []; s.weather.rain = [{ t: 0, intensity: 0 }];
  const ticks = count === 10000 ? 30 : 120;
  const start = performance.now();
  const sim = createSimulation(s, 42, "centralised", { durationTicks: ticks });
  let previous = sim.snapshot();
  assert.equal(previous.npcs.id.length, count);
  assert.equal(previous.vehicles.kind.filter((kind) => kind === VehicleKind.Ambulance).length, s.fleet.ambulances);
  let moved = 0;
  while (!sim.done) {
    sim.step(); const snapshot = sim.snapshot();
    assert(RenderSnapshotSchema.safeParse(snapshot).success);
    assert.equal(snapshot.vehicles.kind.filter((kind) => kind === VehicleKind.Ambulance).length, s.fleet.ambulances);
    for (let i = 0; i < snapshot.npcs.id.length; i++) {
      const distance = Math.hypot(snapshot.npcs.x[i] - previous.npcs.x[i], snapshot.npcs.z[i] - previous.npcs.z[i]);
      assert(distance <= 2.000001, `NPC ${i} teleported ${distance} cells`);
      if (distance > 0) moved++;
    }
    for (let i = 0; i < snapshot.vehicles.id.length; i++) {
      const distance = Math.hypot(snapshot.vehicles.x[i] - previous.vehicles.x[i], snapshot.vehicles.z[i] - previous.vehicles.z[i]);
      assert(distance <= 2.000001, `Car ${i} teleported ${distance} cells`);
      if (distance > 0) assert.notEqual(snapshot.vehicles.state[i], VehicleState.Failed);
    }
    previous = snapshot;
  }
  assert(moved > 0); assert(RunSummarySchema.safeParse(sim.summary()).success);
  results.push({ count, ticks, milliseconds: Math.round(performance.now() - start), movedNpcTicks: moved, events: sim.summary().events.length, finalStranded: sim.summary().metrics.at(-1)!.stranded });
}
console.log(JSON.stringify({ validation: "synthetic movement/load smoke; not rescue stress or release approval", results }, null, 2));

const evacuation = livingFixture();
evacuation.population = { count: 2, mix: { carOwners: 0, limitedMobility: 0, needsAssist: 0 }, schedule: "custom", customSchedule: { departAt: 86399, workTicks: 86400 } };
evacuation.fleet = { ambulances: 0, policeCars: 0, boats: 0, helicopters: 0, doctors: 0, nurses: 0, policeOfficers: 0, boatOperators: 0 };
evacuation.buildings.find((building) => building.type === BlockType.Shelter)!.capacity = 1;
evacuation.weather.warningDelay = 0; evacuation.weather.sources = [{ cell: 9, startT: 0, endT: 100, rate: 0.2 }];
const warnings = runBatch(evacuation, [0, 42, 77], "negotiation", { durationTicks: 120 });
assert(warnings.every((run) => run.events.filter((event) => event.type === "EVAC_ORDER").length === 1));
assert(warnings.every((run) => run.events.some((event) => event.type === "NPC_STRANDED")));
assert.deepEqual(warnings, runBatch(evacuation, [0, 42, 77], "negotiation", { durationTicks: 120 }));
console.log(JSON.stringify({ validation: "three-seed deterministic flood warning and one-seat shelter contention", seeds: [0, 42, 77], ordersPerRun: 1, strandedPerRun: 1 }));

function reportCapacityRun(seed: number) {
  const s = livingFixture();
  const count = 10000;
  s.population = { count, mix: { carOwners: 0, limitedMobility: 0, needsAssist: 0 }, schedule: "custom", customSchedule: { departAt: 86399, workTicks: 86400 } };
  s.fleet = { ambulances: 0, policeCars: 0, boats: 0, helicopters: 0, doctors: 0, nurses: 0, policeOfficers: 0, boatOperators: 0 };
  s.buildings[0].capacity = count; s.buildings[2].capacity = count;
  s.weather.sources = [];
  s.injected = Array.from({ length: count / 2 }, (_, i) => ({ kind: "false_report", tick: 0, cell: i % (s.size.w * s.size.h), confidence: 0.4 }));
  const sim = createSimulation(s, seed, "centralised", { durationTicks: 1, npcParams: { ...defaultNpcParams(s), falseReportRate: 1, commsDelay: 0 } });
  sim.step();
  const snapshot = sim.snapshot(); const summary = sim.summary();
  assert.equal(snapshot.reports.confidence.length, count + count / 2);
  assert(snapshot.reports.confidence.every((value) => value >= 0 && value <= 1));
  assert.equal(summary.events.filter((event) => event.type === "REPORT_CREATED").length, count + count / 2);
  return { snapshot, summary };
}
for (const seed of [0, 42, 77]) assert.deepEqual(reportCapacityRun(seed), reportCapacityRun(seed));
console.log(JSON.stringify({ validation: "three-seed deterministic report capacity smoke", seeds: [0, 42, 77], civilians: 10000, injectedReports: 5000, expectedDelivered: 15000 }));
