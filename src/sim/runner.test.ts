import { expect, it } from "vitest";
import { mockScenario } from "../contracts/mocks/ak";
import { BlockType, VehicleKind } from "../contracts/types";
import type { VehicleId } from "../contracts/types";
import { RenderSnapshotSchema, RunSummarySchema } from "../contracts/sim-schemas";
import { createSimulation, runBatch } from "./runner";
import { defaultNpcParams } from "./agents/population";
import { livingFixture } from "./agents/living-fixture";

function policeStationScenario({ policeCars = 1, policeOfficers = 1, safeAccess = true } = {}) {
  const scenario = livingFixture();
  scenario.blocks[18] = BlockType.PoliceStation;
  scenario.buildings.find((building) => building.id === 3)!.type = BlockType.PoliceStation;
  scenario.fleet.policeCars = policeCars;
  scenario.fleet.policeOfficers = policeOfficers;
  scenario.blocks[2] = BlockType.BoatDepot;
  scenario.buildings.push({ id: 5 as never, type: BlockType.BoatDepot, cells: [2], entrance: 2, capacity: 1, floorHeight: 0 });
  for (const cell of [17, 19, 25, 35]) scenario.blocks[cell] = BlockType.Road;
  if (!safeAccess) for (const cell of [17, 19, 25, 26, 35]) scenario.blocks[cell] = BlockType.Grass;
  return scenario;
}

function boatHospitalScenario(populationCount: number, boatCount = 1) {
  const scenario = mockScenario();
  scenario.population.count = populationCount;
  scenario.fleet.boats = boatCount;
  scenario.fleet.boatOperators = boatCount;
  scenario.blocks[2] = BlockType.BoatDepot;
  scenario.buildings.push({ id: 3 as never, type: BlockType.BoatDepot, cells: [2], entrance: 2, capacity: boatCount, floorHeight: 0 });
  scenario.blocks[22] = BlockType.Road;
  scenario.ground[22] = 2;
  scenario.ground[14] = 2;
  scenario.buildings[1].floorHeight = 2;
  scenario.buildings[1].generator = { fuelTicks: 200 };
  scenario.weather.warningDelay = 0;
  scenario.weather.sources = [{ cell: 9, startT: 0, endT: 120, rate: 1.5 }];
  scenario.injected = [{ kind: "false_report", tick: 32, cell: 9, confidence: 1 }];
  return scenario;
}

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

it("includes only safely deployed police in copied, schema-valid vehicle snapshots", () => {
  const scenario = policeStationScenario();
  const sim = createSimulation(scenario, 42, "centralised", { durationTicks: 2 });
  const snapshot = sim.snapshot();
  expect(Array.from(snapshot.vehicles.id)).toContain(scenario.fleet.ambulances + 1);
  expect(Array.from(snapshot.vehicles.kind)).toContain(VehicleKind.PoliceCar);
  expect(snapshot.vehicles.kind).toContain(VehicleKind.Car);
  expect(snapshot.vehicles.kind).toContain(VehicleKind.Ambulance);
  expect(snapshot.vehicles.kind).toContain(VehicleKind.Boat);
  expect(new Set(snapshot.vehicles.id).size).toBe(snapshot.vehicles.id.length);
  expect(RenderSnapshotSchema.safeParse(snapshot).success).toBe(true);
  snapshot.vehicles.id.fill(-1);
  expect(sim.snapshot().vehicles.id.some((id) => id === -1)).toBe(false);

  const inaccessible = createSimulation(policeStationScenario({ safeAccess: false }), 42, "centralised", { durationTicks: 2 });
  expect(inaccessible.snapshot().vehicles.kind).not.toContain(VehicleKind.PoliceCar);
});

it("keeps police outside rescue assignments and omits unstaffed police from snapshots and events", () => {
  const scenario = policeStationScenario();
  scenario.injected = [{ kind: "false_report", tick: 0, cell: 24, confidence: 1 }];
  const sim = createSimulation(scenario, 42, "centralised", { durationTicks: 2,
    npcParams: { ...defaultNpcParams(scenario), falseReportRate: 0, commsDelay: 0 } });
  sim.step();
  const events = sim.summary().events;
  expect(events.some((event) => event.type === "REQUEST_CREATED")).toBe(true);
  expect(events.some((event) => event.type === "ASSIGNED" && event.actor === 1 && event.actorKind === "vehicle")).toBe(true);
  expect(events.filter((event) => event.actorKind === "vehicle" && event.actor === scenario.fleet.ambulances + 1)
    .every((event) => event.targetKind !== "request")).toBe(true);

  const unstaffed = createSimulation(policeStationScenario({ policeOfficers: 0 }), 42, "centralised", { durationTicks: 2 });
  unstaffed.step();
  expect(unstaffed.snapshot().vehicles.kind).not.toContain(VehicleKind.PoliceCar);
  expect(unstaffed.summary().events.some((event) => event.actorKind === "vehicle" && event.actor === 2)).toBe(false);
  expect(RenderSnapshotSchema.safeParse(unstaffed.snapshot()).success).toBe(true);
  expect(RunSummarySchema.safeParse(unstaffed.summary()).success).toBe(true);

  const empty = createSimulation(policeStationScenario({ policeCars: 0 }), 42, "centralised", { durationTicks: 2 });
  empty.step();
  expect(empty.snapshot().vehicles.kind).not.toContain(VehicleKind.PoliceCar);
  expect(empty.summary().events.some((event) => event.actorKind === "vehicle" && event.actor === 2)).toBe(false);
});

it("replays police vehicles, events and metrics identically for the same seed", () => {
  const scenario = policeStationScenario();
  const first = createSimulation(scenario, 73, "centralised", { durationTicks: 8 });
  const second = createSimulation(scenario, 73, "centralised", { durationTicks: 8 });
  for (let tick = 0; tick < 8; tick++) { first.step(); second.step(); }
  expect(first.summary().events).toEqual(second.summary().events);
  expect(first.snapshot().vehicles).toEqual(second.snapshot().vehicles);
  expect(first.summary().metrics).toEqual(second.summary().metrics);
  expect(RunSummarySchema.safeParse(first.summary()).success).toBe(true);
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

it("uses a boat only when the delivered report has no safe ambulance route", () => {
  const scenario = mockScenario();
  scenario.fleet.boats = 2;
  scenario.fleet.boatOperators = 2;
  scenario.blocks[9] = BlockType.BoatDepot;
  scenario.buildings[0].type = BlockType.BoatDepot;
  scenario.buildings[0].capacity = 1;
  for (let cell = 24; cell <= 31; cell++) scenario.blocks[cell] = BlockType.Grass;
  scenario.weather.sources = [8, 16, 24].map((cell) => ({ cell, startT: 0, endT: 12, rate: 2 }));
  scenario.injected = [{ kind: "false_report", tick: 0, cell: 24, confidence: 1 }];
  const options = { durationTicks: 20, npcParams: { ...defaultNpcParams(scenario), falseReportRate: 0, commsDelay: 0 } };
  const sim = createSimulation(scenario, 42, "centralised", options);
  for (let tick = 0; tick < 20; tick++) sim.step();

  const events = sim.summary().events;
  expect(events.some((event) => event.type === "ASSIGNED" && event.actorKind === "vehicle" && event.actor === 3 && /boat/i.test(event.reason))).toBe(true);
  expect(events.filter((event) => event.type === "ASSIGNED" && event.data?.mode === "boat")).toHaveLength(1);
  expect(events.some((event) => event.type === "REPORT_FALSE" && /Boat field search/.test(event.reason))).toBe(true);
  expect(sim.snapshot().vehicles.kind).toContain(VehicleKind.Boat);
  expect(JSON.stringify(sim.summary())).toBe(JSON.stringify(runBatch(scenario, [42], "centralised", options)[0]));
  const centralRuns = runBatch(scenario, [42, 43, 44], "centralised", options);
  const negotiationRuns = runBatch(scenario, [42, 43, 44], "negotiation", options);
  for (let index = 0; index < centralRuns.length; index++) {
    expect(negotiationRuns[index].metrics).toEqual(centralRuns[index].metrics);
    expect(negotiationRuns[index].events.filter((event) => event.type === "REPORT_VERIFIED" || event.type === "REPORT_FALSE"))
      .toEqual(centralRuns[index].events.filter((event) => event.type === "REPORT_VERIFIED" || event.type === "REPORT_FALSE"));
  }
});

it("does not hand an injured passenger off at a road closed by debris", () => {
  const scenario = boatHospitalScenario(1);
  scenario.injected.push({ kind: "road_blocked_by_debris", tick: 32, cell: 22 });
  const sim = createSimulation(scenario, 42, "centralised", { durationTicks: 70,
    npcParams: { ...defaultNpcParams(scenario), falseReportRate: 0, awarenessMean: 0, commsDelay: 0 } });
  for (let tick = 0; tick < 70; tick++) sim.step();

  const events = sim.summary().events;
  expect(events.some((event) => event.reason?.includes("handed off at a safe road-accessible shore"))).toBe(false);
  expect(sim.summary().metrics.at(-1)!.unmet).toBeGreaterThan(0);
});

it("repeat-trips a five-casualty incident and admits every boat-transported patient", () => {
  const scenario = boatHospitalScenario(5);
  const sim = createSimulation(scenario, 42, "centralised", { durationTicks: 100,
    npcParams: { ...defaultNpcParams(scenario), falseReportRate: 0, awarenessMean: 0, commsDelay: 0 } });
  for (let tick = 0; tick < 100; tick++) sim.step();

  const events = sim.summary().events;
  const boardings = events.filter((event) => event.reason?.includes("civilian boarded"));
  const handoffs = events.filter((event) => event.reason?.includes("handed off at a safe road-accessible shore"));
  const hospitalAssignments = events.filter((event) => event.type === "HOSPITAL_ASSIGN");
  const admissions = events.filter((event) => event.type === "SERVED" && event.reason?.includes("admitted"));
  expect(boardings).toHaveLength(5);
  expect(new Set(boardings.map((event) => event.tick)).size).toBeGreaterThan(1);
  expect(Math.max(...Array.from(new Set(boardings.map((event) => event.tick)), (tick) => boardings.filter((event) => event.tick === tick).length))).toBeLessThanOrEqual(4);
  expect(handoffs).toHaveLength(5);
  expect(hospitalAssignments).toHaveLength(5);
  expect(admissions).toHaveLength(5);
  expect(sim.summary().metrics.at(-1)!.unmet).toBe(0);
});

it("handles two rescue boats arriving at distinct incident scenes in the same tick", () => {
  const scenario = boatHospitalScenario(2, 2);
  scenario.buildings[0].capacity = 1;
  scenario.blocks[11] = BlockType.House;
  scenario.buildings.push({ id: 4 as never, type: BlockType.House, cells: [11], entrance: 11, capacity: 1, floorHeight: 1 });
  scenario.weather.sources = [9, 11].map((cell) => ({ cell, startT: 0, endT: 120, rate: 1.5 }));
  scenario.injected = [
    { kind: "false_report", tick: 32, cell: 9, confidence: 1 },
    { kind: "false_report", tick: 32, cell: 11, confidence: 1 },
  ];
  const sim = createSimulation(scenario, 42, "centralised", { durationTicks: 100,
    npcParams: { ...defaultNpcParams(scenario), falseReportRate: 0, awarenessMean: 0, commsDelay: 0 } });
  for (let tick = 0; tick < 100; tick++) sim.step();

  const events = sim.summary().events;
  const boatAssignments = events.filter((event) => event.type === "ASSIGNED" && event.data?.mode === "boat" && event.tick === 32);
  const boardings = events.filter((event) => event.reason?.includes("civilian boarded"));
  const handoffs = events.filter((event) => event.reason?.includes("handed off at a safe road-accessible shore"));
  expect(boatAssignments).toHaveLength(2);
  expect(new Set(boatAssignments.map((event) => event.actor)).size).toBe(2);
  expect(boardings).toHaveLength(2);
  expect(new Set(boardings.map((event) => event.tick)).size).toBe(1);
  expect(new Set(boardings.map((event) => event.target)).size).toBe(2);
  expect(handoffs).toHaveLength(2);
  expect(events.filter((event) => event.type === "SERVED" && event.reason?.includes("admitted"))).toHaveLength(2);
  expect(sim.summary().metrics.at(-1)!.unmet).toBe(0);
});

it("applies boat failure at tick zero and removes the failed boat from snapshots", () => {
  const scenario = mockScenario();
  scenario.injected = [{ kind: "boat_failure", tick: 0, vehicleId: 3 as VehicleId }];
  const sim = createSimulation(scenario, 42, "centralised", { durationTicks: 1 });
  expect(sim.summary().events.some((event) => event.type === "INJECTED" && event.actor === 3)).toBe(true);
  expect(sim.snapshot().vehicles.kind).not.toContain(VehicleKind.Boat);
  expect(RunSummarySchema.safeParse(sim.summary()).success).toBe(true);
});

it("ignores a scheduled failure for a configured boat without an operator", () => {
  const scenario = mockScenario();
  scenario.fleet.boats = 2;
  scenario.fleet.boatOperators = 1;
  scenario.injected = [{ kind: "boat_failure", tick: 0, vehicleId: 4 as VehicleId }];
  const sim = createSimulation(scenario, 42, "centralised", { durationTicks: 1 });
  expect(sim.summary().events.some((event) => event.type === "INJECTED" && event.actor === 4)).toBe(true);
  expect(sim.snapshot().vehicles.kind).not.toContain(VehicleKind.Boat);
});

it("keeps a safely routed incident ambulance-owned instead of racing a boat", () => {
  const scenario = mockScenario();
  scenario.blocks[9] = BlockType.BoatDepot;
  scenario.buildings[0].type = BlockType.BoatDepot;
  scenario.buildings[0].capacity = 1;
  for (const cell of [13, 21, 29, 37, 38, 39, 32]) scenario.blocks[cell] = BlockType.Road;
  scenario.weather.sources = [8, 16, 24].map((cell) => ({ cell, startT: 0, endT: 12, rate: 2 }));
  scenario.injected = [{ kind: "false_report", tick: 0, cell: 24, confidence: 1 }];
  const sim = createSimulation(scenario, 42, "centralised", { durationTicks: 1,
    npcParams: { ...defaultNpcParams(scenario), falseReportRate: 0, commsDelay: 0 } });
  sim.step();
  const assignments = sim.summary().events.filter((event) => event.type === "ASSIGNED");
  expect(assignments).toHaveLength(1);
  expect(assignments[0].actor).toBe(1);
  expect(assignments[0].reason).toMatch(/ambulance/i);
});

it("requeues a boat-owned incident when its boat fails en route", () => {
  const scenario = mockScenario();
  scenario.blocks[9] = BlockType.BoatDepot;
  scenario.buildings[0].type = BlockType.BoatDepot;
  scenario.buildings[0].capacity = 1;
  for (let cell = 24; cell <= 31; cell++) scenario.blocks[cell] = BlockType.Grass;
  scenario.weather.sources = [8, 16, 24].map((cell) => ({ cell, startT: 0, endT: 12, rate: 2 }));
  scenario.injected = [{ kind: "false_report", tick: 0, cell: 24, confidence: 1 }, { kind: "boat_failure", tick: 7, vehicleId: 3 as VehicleId }];
  const sim = createSimulation(scenario, 42, "centralised", { durationTicks: 8,
    npcParams: { ...defaultNpcParams(scenario), falseReportRate: 0, commsDelay: 0 } });
  for (let tick = 0; tick < 8; tick++) sim.step();
  const events = sim.summary().events;
  expect(events.some((event) => event.type === "ASSIGNED" && event.actor === 3)).toBe(true);
  expect(events.some((event) => event.type === "INJECTED" && event.actor === 3)).toBe(true);
  expect(events.some((event) => event.type === "COMMIT_CANCELLED" && event.actor === 3 && /Boat failed/.test(event.reason))).toBe(true);
});
