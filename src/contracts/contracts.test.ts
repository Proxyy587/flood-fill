import { describe, expect, it } from "vitest";
import { BlockType, ScenarioSchema, EditCommandSchema, MainToWorkerSchema, RunSummarySchema, RenderSnapshotSchema, InspectorDataSchema, VehicleIdSchema } from "./index";
import { mockScenario, mockRunSummary, mockSnapshotStream } from "./mocks";

describe("scenario boundary", () => {
  it("rejects building tiles without definitions and Float32 overflow inputs", () => {
    const s = mockScenario(); s.blocks[0] = BlockType.Hospital;
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
    const t = mockScenario(); t.weather.sources[0].rate = 1e40;
    expect(ScenarioSchema.safeParse(t).success).toBe(false);
    const u = mockScenario(); u.buildings[0].floorHeight = 1e40;
    expect(ScenarioSchema.safeParse(u).success).toBe(false);
  });
  it("accepts the source-count boundary and rejects one beyond it", () => {
    const s = mockScenario();
    s.weather.sources = Array.from({ length: 16384 }, () => ({ cell: 0, startT: 0, endT: 1, rate: 0 }));
    expect(ScenarioSchema.safeParse(s).success).toBe(true);
    s.weather.sources.push({ cell: 0, startT: 0, endT: 1, rate: 0 });
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
  });
  it("rejects fleet and roster allocation beyond supported resource budgets", () => {
    const s = mockScenario(); s.fleet.ambulances = 2147483647; s.fleet.boats = 1;
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
    const t = mockScenario(); t.fleet.ambulances = 10000; t.population.mix.carOwners = 1;
    expect(ScenarioSchema.safeParse(t).success).toBe(false);
    const u = mockScenario(); u.fleet.doctors = 10000; u.fleet.nurses = 1;
    expect(ScenarioSchema.safeParse(u).success).toBe(false);
  });
  it("accepts exactly 10000 vehicles including cars and exactly 10000 staff", () => {
    const s = mockScenario();
    s.fleet = { ambulances: 9998, policeCars: 0, boats: 0, helicopters: 0, doctors: 9998, nurses: 2, policeOfficers: 0, boatOperators: 0 };
    // round(6 civilians * 0.3 ownership) = two cars, after emergency fleet IDs.
    expect(ScenarioSchema.safeParse(s).success).toBe(true);
    s.fleet.ambulances++;
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
  });
  it("accepts a synthetic fixture and preserves it through JSON", () => {
    const s = mockScenario();
    expect(ScenarioSchema.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it.each([0, 129, 1.5])("rejects invalid width %s", (w) => {
    const s = mockScenario(); s.size.w = w;
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
  });
  it("rejects wrong array lengths and nonfinite terrain", () => {
    const s = mockScenario(); s.ground.pop();
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
    const t = mockScenario(); t.ground[0] = Infinity;
    expect(ScenarioSchema.safeParse(t).success).toBe(false);
  });
  it("rejects out-of-grid sources and unresolved power references", () => {
    const s = mockScenario(); s.weather.sources[0].cell = 100000;
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
    const t = mockScenario(); t.powerGrid.edges.push([0, 999]);
    expect(ScenarioSchema.safeParse(t).success).toBe(false);
  });
  it("rejects duplicate IDs, overlapping buildings and misplaced entrances", () => {
    const s = mockScenario(); s.buildings.push({ ...s.buildings[0] });
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
    const t = mockScenario(); t.buildings[0].entrance = t.ground.length;
    expect(ScenarioSchema.safeParse(t).success).toBe(false);
  });
  it("rejects bad weather ordering, district references and injected targets", () => {
    const s = mockScenario(); s.weather.rain = [{ t: 10, intensity: 0 }, { t: 2, intensity: 1 }];
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
    const t = mockScenario(); t.districts[0].cells.push(-1);
    expect(ScenarioSchema.safeParse(t).success).toBe(false);
    const u = mockScenario(); u.injected = [{ kind: "substation_flooded", tick: 2, nodeId: 999 }];
    expect(ScenarioSchema.safeParse(u).success).toBe(false);
  });
  it("resolves injected boat IDs against deterministic fleet ordering", () => {
    const s = mockScenario(); s.fleet.boats = 0;
    s.injected = [{ kind: "boat_failure", tick: 2, vehicleId: VehicleIdSchema.parse(1) }];
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
    s.fleet.boats = 1; s.injected[0] = { kind: "boat_failure", tick: 2, vehicleId: VehicleIdSchema.parse(3) };
    expect(ScenarioSchema.safeParse(s).success).toBe(true);
  });
});

describe("commands and fixtures", () => {
  it("rejects nonpositive, duplicate snapshot IDs and invalid enum values", () => {
    const s = [...mockSnapshotStream(1)][0]; s.npcs.id[0] = 0;
    expect(RenderSnapshotSchema.safeParse(s).success).toBe(false);
    s.npcs.id[0] = 1; s.npcs.role[0] = 255;
    expect(RenderSnapshotSchema.safeParse(s).success).toBe(false);
    s.npcs.role[0] = 0; s.npcs.state[0] = 255;
    expect(RenderSnapshotSchema.safeParse(s).success).toBe(false);
    const t = [...mockSnapshotStream(1)][0];
    t.npcs = { id: new Int32Array([1, 1]), x: new Float32Array(2), z: new Float32Array(2), heading: new Float32Array(2), role: new Uint8Array(2), state: new Uint8Array(2) };
    expect(RenderSnapshotSchema.safeParse(t).success).toBe(false);
  });
  it("rejects invalid building footprints in individual and patch commands", () => {
    const def = { type: BlockType.Road, cells: [1], entrance: 1, capacity: 1, floorHeight: 1 };
    expect(EditCommandSchema.safeParse({ kind: "placeBuilding", def }).success).toBe(false);
    expect(EditCommandSchema.safeParse({ kind: "placeBuilding", def: { ...def, type: BlockType.House, cells: [1, 1] } }).success).toBe(false);
    expect(EditCommandSchema.safeParse({ kind: "placeBuilding", def: { ...def, type: BlockType.House, entrance: 2 } }).success).toBe(false);
  });
  it("distinguishes cell indices from positive branded inspector IDs", () => {
    expect(MainToWorkerSchema.safeParse({ kind: "inspect", entityKind: "cell", id: 0 }).success).toBe(true);
    expect(MainToWorkerSchema.safeParse({ kind: "inspect", entityKind: "npc", id: 0 }).success).toBe(false);
    expect(MainToWorkerSchema.safeParse({ kind: "inspect", entityKind: "npc", id: 2147483648 }).success).toBe(false);
    expect(InspectorDataSchema.safeParse({ kind: "npc", id: 0, title: "bad", attributes: {} }).success).toBe(false);
  });
  it("accepts safe commands and rejects unknown kinds", () => {
    expect(EditCommandSchema.safeParse({ kind: "setBlock", cell: 0, block: BlockType.Road }).success).toBe(true);
    expect(EditCommandSchema.safeParse({ kind: "deleteEverything" }).success).toBe(false);
  });
  it("rejects recursively nested patches", () => {
    const patch = { title: "test", rationale: "test", commands: [], estimatedCost: 1 };
    expect(EditCommandSchema.safeParse({ kind: "applyPatch", patch: { ...patch, commands: [{ kind: "applyPatch", patch }] } }).success).toBe(false);
  });
  it("validates the worker protocol and rejects malformed options", () => {
    expect(MainToWorkerSchema.safeParse({ kind: "load", scenario: mockScenario(), seed: 42, options: { durationTicks: 60 } }).success).toBe(true);
    expect(MainToWorkerSchema.safeParse({ kind: "setSpeed", speed: 0 }).success).toBe(false);
    expect(MainToWorkerSchema.safeParse({ kind: "seek", tick: -1 }).success).toBe(false);
  });
  it("ships labelled summaries and independent snapshot buffers", () => {
    expect(RunSummarySchema.parse(mockRunSummary()).scenario).toContain("MOCK");
    const snapshots = [...mockSnapshotStream(2)];
    snapshots[0].water[0] = 99;
    expect(snapshots[1].water[0]).not.toBe(99);
  });
});
