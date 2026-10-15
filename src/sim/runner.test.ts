import { expect, it } from "vitest";
import { mockScenario } from "../contracts/mocks";
import { RenderSnapshotSchema, RunSummarySchema } from "../contracts";
import { createSimulation, runBatch } from "./runner";

it("replays a batch byte-identically without mutating the input", () => {
  const s = mockScenario(); const original = JSON.stringify(s);
  const first = runBatch(s, [0, 42, 77], "centralised", { durationTicks: 40 });
  expect(JSON.stringify(first)).toBe(JSON.stringify(runBatch(s, [0, 42, 77], "centralised", { durationTicks: 40 })));
  expect(JSON.stringify(s)).toBe(original);
  first.forEach((summary) => expect(RunSummarySchema.safeParse(summary).success).toBe(true));
});
it.each([0, 1, 2])("applies injected substation faults at state boundary %s", (faultTick) => {
  const s = mockScenario(); s.buildings[1].generator = { fuelTicks: 2 };
  s.injected = [{ kind: "substation_flooded", tick: faultTick, nodeId: 1 }];
  const sim = createSimulation(s, 42, "centralised", { durationTicks: 5 });
  while (sim.tick < faultTick) sim.step();
  expect(sim.snapshot().powered[9]).toBe(0); expect(sim.snapshot().powered[14]).toBe(2);
  const log = sim.summary().events;
  expect(log.find((e) => e.type === "POWER_TRIP")?.tick).toBe(faultTick);
  expect(log.find((e) => e.type === "GENERATOR_START")?.tick).toBe(faultTick);
  while (sim.tick < faultTick + 2) sim.step();
  expect(sim.snapshot().powered[14]).toBe(0);
});
it("advances one second at a time and records final metrics", () => {
  const sim = createSimulation(mockScenario(), 42, "negotiation", { durationTicks: 21, metricsEvery: 10 });
  expect(sim.tick).toBe(0);
  for (let t = 0; t < 21; t++) sim.step();
  expect(sim.tick).toBe(21); expect(sim.done).toBe(true);
  expect(sim.summary().metrics.map((m) => m.tick)).toEqual([0, 10, 20, 21]);
  expect(() => sim.step()).toThrow();
});
it("snapshots and summaries own arrays and never detach or mutate live state", () => {
  const sim = createSimulation(mockScenario(), 42, "negotiation", { durationTicks: 2 });
  const snapshot = sim.snapshot(); expect(RenderSnapshotSchema.safeParse(snapshot).success).toBe(true);
  structuredClone(snapshot, { transfer: [snapshot.water.buffer] });
  expect(sim.snapshot().water.length).toBe(64);
  const summary = sim.summary(); summary.events[0].reason = "changed";
  expect(sim.summary().events[0].reason).not.toBe("changed");
});
it("measures actual flood/power effects and declares unavailable dispatch evidence", () => {
  const s = mockScenario(); s.weather.sources = [{ cell: 6, startT: 0, endT: 5, rate: 2 }];
  const [run] = runBatch(s, [42], "negotiation", { durationTicks: 10 });
  expect(run.metrics.at(-1)!.maxDepth).toBeGreaterThan(0);
  expect(run.events.some((e) => e.type === "POWER_TRIP")).toBe(true);
  expect(run.events[0].data?.dispatchImplemented).toBe(false);
});
it("rejects invalid seeds, duration, mode and unsupported injected actions", () => {
  expect(() => runBatch(mockScenario(), [-1], "negotiation")).toThrow();
  expect(() => runBatch(mockScenario(), [42], "negotiation", { durationTicks: 0 })).toThrow();
  const s = mockScenario(); s.injected = [{ kind: "comms_outage", tick: 1, durationTicks: 4 }];
  expect(() => createSimulation(s, 42, "negotiation")).toThrow(/not implemented/);
});
it("rejects sparse seed lists instead of returning holes/null summaries", () => {
  expect(() => runBatch(mockScenario(), new Array<number>(1), "centralised", { durationTicks: 1 })).toThrow();
});
