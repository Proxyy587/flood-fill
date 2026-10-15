import { expect, it } from "vitest";
import { mockScenario } from "../contracts/mocks";
import { RenderSnapshotSchema, RunSummarySchema } from "../contracts";
import { createSimulation, runBatch } from "./runner";
import { defaultNpcParams } from "./agents/population";

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
it("rejects invalid seeds, duration and mode", () => {
  expect(() => runBatch(mockScenario(), [-1], "negotiation")).toThrow();
  expect(() => runBatch(mockScenario(), [42], "negotiation", { durationTicks: 0 })).toThrow();
});
it("delivers injected synthetic reports after delay and communications recovery", () => {
  const s = mockScenario();
  s.injected = [{ kind: "false_report", tick: 0, cell: 12, confidence: 0.8 }, { kind: "comms_outage", tick: 0, durationTicks: 2 }];
  const sim = createSimulation(s, 42, "negotiation", { durationTicks: 4, npcParams: { ...defaultNpcParams(s), falseReportRate: 0 } });
  expect(sim.snapshot().reports.confidence).toHaveLength(0);
  sim.step(); sim.step();
  expect(sim.snapshot().reports.confidence).toHaveLength(0);
  sim.step();
  const snapshot = sim.snapshot();
  expect(snapshot.reports.confidence).toEqual(new Float32Array([0.8]));
  expect(RenderSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(sim.summary().events.find((event) => event.type === "REPORT_CREATED")?.tick).toBe(3);
  snapshot.reports.confidence[0] = 0;
  expect(sim.snapshot().reports.confidence[0]).toBeCloseTo(0.8);
});
it("delivers tick-zero reports immediately when there is no delay or outage", () => {
  const s = mockScenario(); s.injected = [{ kind: "false_report", tick: 0, cell: 12, confidence: 0.6 }];
  const sim = createSimulation(s, 42, "negotiation", { durationTicks: 1, npcParams: { panicMean: 0.2, complianceMean: 0.8, riskToleranceMean: 0.35, altruismMean: 0.5, awarenessMean: 0.7, carOwnership: s.population.mix.carOwners, warningDelay: s.weather.warningDelay, falseReportRate: 0, commsDelay: 0, staffFatigueRate: 0.00002 } });
  expect(sim.snapshot().reports.confidence).toEqual(new Float32Array([0.6]));
  expect(sim.summary().events.find((event) => event.type === "REPORT_CREATED")?.tick).toBe(0);
});
it("rejects sparse seed lists instead of returning holes/null summaries", () => {
  expect(() => runBatch(mockScenario(), new Array<number>(1), "centralised", { durationTicks: 1 })).toThrow();
});
