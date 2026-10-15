import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { RenderSnapshotSchema, RunSummarySchema, VehicleState } from "../src/contracts";
import { createSimulation } from "../src/sim";
import { livingFixture } from "../src/sim/agents/living-fixture";

// Synthetic throughput probes, not the five-failure rescue stress scenario.
const results = [];
for (const count of [12, 1000, 10000]) {
  const s = livingFixture();
  s.name = `MOCK living health ${count}`;
  s.population = { count, mix: { carOwners: 0.3, limitedMobility: 0.1, needsAssist: 0.1 }, schedule: "custom", customSchedule: { departAt: 0, workTicks: 5 } };
  s.fleet = { ambulances: 0, policeCars: 0, boats: 0, helicopters: 0, doctors: 0, nurses: 0, policeOfficers: 0, boatOperators: 0 };
  s.buildings[0].capacity = count; s.buildings[2].capacity = count;
  s.weather.sources = []; s.weather.rain = [{ t: 0, intensity: 0 }];
  const ticks = count === 10000 ? 30 : 120;
  const start = performance.now();
  const sim = createSimulation(s, 42, "centralised", { durationTicks: ticks });
  let previous = sim.snapshot();
  assert.equal(previous.npcs.id.length, count);
  let moved = 0;
  while (!sim.done) {
    sim.step(); const snapshot = sim.snapshot();
    assert(RenderSnapshotSchema.safeParse(snapshot).success);
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
