import { expect, it } from "vitest";
import { mockScenario } from "../contracts/mocks/ak";
import { BlockType, VehicleKind } from "../contracts/types";
import { RenderSnapshotSchema, RunSummarySchema } from "../contracts/sim-schemas";
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
it("measures actual flood/power effects and reports implemented dispatch capability", () => {
  const s = mockScenario(); s.weather.sources = [{ cell: 6, startT: 0, endT: 5, rate: 2 }];
  const [run] = runBatch(s, [42], "negotiation", { durationTicks: 10 });
  expect(run.metrics.at(-1)!.maxDepth).toBeGreaterThan(0);
  expect(run.events.some((e) => e.type === "POWER_TRIP")).toBe(true);
  expect(run.events[0].data?.dispatchImplemented).toBe(true);
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

it("reports M3B capabilities and projects the finite ambulance fleet in owned snapshots", () => {
  const scenario = mockScenario();
  scenario.fleet.ambulances = 2;
  const sim = createSimulation(scenario, 42, "negotiation", { durationTicks: 2 });
  expect(sim.summary().events[0].data).toMatchObject({ reportsImplemented: true, dispatchImplemented: true });
  expect(sim.summary().events[0].data?.stage).toBe("dispatch");
  expect(sim.summary().events[0].reason).not.toContain("reports, rescue dispatch");
  const snapshot = sim.snapshot();
  expect(Array.from(snapshot.vehicles.kind).filter((kind) => kind === VehicleKind.Ambulance)).toHaveLength(2);
  expect(RenderSnapshotSchema.safeParse(snapshot).success).toBe(true);
  snapshot.vehicles.id.fill(-1);
  expect(sim.snapshot().vehicles.id.some((id) => id === -1)).toBe(false);
});

it("dispatches a delivered report request and lets field evidence falsify it", () => {
  const scenario = mockScenario();
  scenario.fleet.ambulances = 1;
  scenario.injected = [{ kind: "false_report", tick: 0, cell: 24, confidence: 1 }];
  const sim = createSimulation(scenario, 42, "centralised", { durationTicks: 2, npcParams: { ...defaultNpcParams(scenario), falseReportRate: 0, commsDelay: 0 } });
  expect(sim.summary().events.some((event) => event.type === "REQUEST_CREATED")).toBe(true);
  sim.step();
  const events = sim.summary().events;
  expect(events.some((event) => event.type === "ASSIGNED" && event.actorKind === "vehicle")).toBe(true);
  expect(events.some((event) => event.type === "REPORT_FALSE")).toBe(true);
  expect(events.find((event) => event.type === "REPORT_FALSE")?.data?.reportId).toBe(1);
  expect(sim.snapshot().vehicles.kind).toContain(VehicleKind.Ambulance);
});

it("keeps world and delivered report truth identical across dispatch policies", () => {
  const scenario = mockScenario();
  scenario.blocks[13] = BlockType.Road;
  scenario.injected = [{ kind: "false_report", tick: 0, cell: 24, confidence: 0.75 }];
  const options = { durationTicks: 3, npcParams: { ...defaultNpcParams(scenario), falseReportRate: 0, commsDelay: 0 } };
  const negotiation = createSimulation(scenario, 73, "negotiation", options);
  const centralised = createSimulation(scenario, 73, "centralised", options);
  for (let tick = 0; tick < 3; tick++) { negotiation.step(); centralised.step(); }

  expect(negotiation.snapshot().water).toEqual(centralised.snapshot().water);
  expect(negotiation.snapshot().npcs).toEqual(centralised.snapshot().npcs);
  expect(negotiation.snapshot().reports).toEqual(centralised.snapshot().reports);
  expect(negotiation.summary().events.filter((event) => event.type === "REPORT_CREATED")).toEqual(centralised.summary().events.filter((event) => event.type === "REPORT_CREATED"));
  expect(RunSummarySchema.safeParse(negotiation.summary()).success).toBe(true);
});

it("triages a flood-stranded civilian, reserves a powered hospital bed and admits them", () => {
  const scenario = mockScenario();
  scenario.population.count = 1;
  scenario.weather.warningDelay = 0;
  scenario.weather.sources = [{ cell: 9, startT: 0, endT: 30, rate: 0.2 }];
  scenario.fleet.ambulances = 1;
  scenario.blocks[13] = BlockType.Road;
  scenario.blocks[21] = BlockType.Road;
  scenario.blocks[29] = BlockType.Road;
  scenario.injected = [{ kind: "false_report", tick: 0, cell: 24, confidence: 0 }];
  const sim = createSimulation(scenario, 42, "centralised", { durationTicks: 24,
    npcParams: { ...defaultNpcParams(scenario), falseReportRate: 0, awarenessMean: 0, commsDelay: 0 } });
  for (let tick = 0; tick < 24; tick++) sim.step();

  const events = sim.summary().events;
  expect(events.some((event) => event.type === "NPC_STRANDED")).toBe(true);
  expect(events.some((event) => event.type === "REPORT_VERIFIED")).toBe(true);
  expect(events.some((event) => event.type === "HOSPITAL_ASSIGN")).toBe(true);
  expect(events.some((event) => event.type === "SERVED")).toBe(true);
  expect(sim.summary().metrics.at(-1)!.unmet).toBe(0);
});
