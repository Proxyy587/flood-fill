import { z } from "zod";
import { BlockType, SIM_EVENT_TYPES, NpcRole, NpcState, VehicleKind, VehicleState, ReportStatus } from "./types";
import type { BuildingId, VehicleId, NpcId, RequestId, Scenario, SimEvent, RunSummary, MainToWorker, NpcParams, InspectorData, MetricsFrame, RenderSnapshot, WorkerToMain } from "./types";

const count = z.number().int().nonnegative();
const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const unit = finite.min(0).max(1);
export const SeedSchema = count.max(0xffffffff);
export const DispatchModeSchema = z.enum(["negotiation", "centralised"]);
export const BuildingIdSchema = count.min(1).max(0x7fffffff).transform((n) => n as BuildingId);
export const VehicleIdSchema = count.min(1).max(0x7fffffff).transform((n) => n as VehicleId);
export const NpcIdSchema = count.min(1).max(0x7fffffff).transform((n) => n as NpcId);
export const RequestIdSchema = count.min(1).max(0x7fffffff).transform((n) => n as RequestId);
const block = z.enum(BlockType);
const buildingShape = {
  type: block, cells: z.array(count).min(1), capacity: count,
  entrance: count, floorHeight: nonnegative.max(255),
  generator: z.strictObject({ fuelTicks: count }).optional(),
  helipad: z.boolean().optional(), powerNode: count.optional(),
};
export const BuildingDefSchema = z.strictObject({ id: BuildingIdSchema, ...buildingShape });
export const InjectedEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("bridge_closed"), tick: count, cell: count }),
  z.strictObject({ kind: z.literal("road_blocked_by_debris"), tick: count, cell: count }),
  z.strictObject({ kind: z.literal("boat_failure"), tick: count, vehicleId: VehicleIdSchema }),
  z.strictObject({ kind: z.literal("shelter_overflow"), tick: count, buildingId: BuildingIdSchema }),
  z.strictObject({ kind: z.literal("substation_flooded"), tick: count, nodeId: count }),
  z.strictObject({ kind: z.literal("false_report"), tick: count, cell: count, confidence: unit }),
  z.strictObject({ kind: z.literal("comms_outage"), tick: count, durationTicks: count.min(1) }),
  z.strictObject({ kind: z.literal("helicopter_grounded_wind"), tick: count, speed: nonnegative, durationTicks: count.min(1) }),
]);
const weather = z.strictObject({
  rain: z.array(z.strictObject({ t: count, intensity: unit })).min(1),
  wind: z.array(z.strictObject({ t: count, speed: nonnegative })).min(1),
  floodKind: z.enum(["growing", "flash", "compound"]),
  sources: z.array(z.strictObject({ cell: count, startT: count, endT: count, rate: nonnegative.max(1000) })).max(16384),
  warningDelay: count,
});
const buildingTypes = new Set([BlockType.House, BlockType.Apartment, BlockType.Office, BlockType.Shop,
  BlockType.Hospital, BlockType.PoliceStation, BlockType.FloodHQ, BlockType.BoatDepot,
  BlockType.FireStation, BlockType.Shelter, BlockType.Helipad, BlockType.PowerPlant, BlockType.Substation]);

export const ScenarioSchema: z.ZodType<Scenario> = z.strictObject({
  schemaVersion: z.literal(1), name: z.string().trim().min(1).max(120),
  size: z.strictObject({ w: count.min(1).max(128), h: count.min(1).max(128) }),
  ground: z.array(count.max(255)), blocks: z.array(block), buildings: z.array(BuildingDefSchema),
  bridges: z.array(z.strictObject({ cell: count, deckHeight: nonnegative.max(510) })).max(16384).optional(),
  districts: z.array(z.strictObject({ id: count, name: z.string().min(1), cells: z.array(count).min(1) })).min(1),
  population: z.strictObject({ count: count.max(10000), mix: z.strictObject({ carOwners: unit, limitedMobility: unit, needsAssist: unit }), schedule: z.enum(["office-hours", "night", "custom"]), customSchedule: z.strictObject({ departAt: count.max(86399), workTicks: count.min(1).max(86400) }).optional() }),
  fleet: z.strictObject({ ambulances: count, policeCars: count, boats: count, helicopters: count, doctors: count, nurses: count, policeOfficers: count, boatOperators: count }),
  weather, injected: z.array(InjectedEventSchema),
  powerGrid: z.strictObject({ nodes: z.array(z.strictObject({ id: count, kind: z.enum(["plant", "substation", "load"]), cell: count, building: BuildingIdSchema.optional() })), edges: z.array(z.tuple([count, count])) }),
  defaults: z.strictObject({ dispatchMode: DispatchModeSchema, seed: SeedSchema }),
}).superRefine((s, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const length = s.size.w * s.size.h;
  const inGrid = (cell: number, path: (string | number)[]) => { if (cell >= length) issue(path, "Cell outside grid"); };
  if (s.ground.length !== length) issue(["ground"], "Expected w*h entries");
  if (s.blocks.length !== length) issue(["blocks"], "Expected w*h entries");
  const bridgeCells = new Set<number>();
  s.bridges?.forEach((b, i) => {
    inGrid(b.cell, ["bridges", i, "cell"]);
    if (s.blocks[b.cell] !== BlockType.Bridge || bridgeCells.has(b.cell)) issue(["bridges", i, "cell"], "Expected unique bridge cell");
    if (b.deckHeight <= s.ground[b.cell]) issue(["bridges", i, "deckHeight"], "Deck must be above terrain");
    bridgeCells.add(b.cell);
  });
  if ((s.population.schedule === "custom") !== (s.population.customSchedule !== undefined)) issue(["population", "customSchedule"], "Custom schedule requires departAt/workTicks; other schedules must omit it");
  if (s.population.mix.limitedMobility + s.population.mix.needsAssist > 1) issue(["population", "mix"], "Mobility shares must sum to at most 1");
  const civilianCars = Math.round(s.population.count * s.population.mix.carOwners);
  const fleetCount = s.fleet.ambulances + s.fleet.policeCars + s.fleet.boats + s.fleet.helicopters + civilianCars;
  const staffCount = s.fleet.doctors + s.fleet.nurses + s.fleet.policeOfficers + s.fleet.boatOperators;
  if (!Number.isSafeInteger(fleetCount) || fleetCount > 10000) issue(["fleet"], "Total vehicles including civilian cars must not exceed 10000");
  if (!Number.isSafeInteger(staffCount) || staffCount > 10000) issue(["fleet"], "Total staff must not exceed 10000");
  const ids = new Set<number>(); const occupied = new Set<number>();
  s.buildings.forEach((b, i) => {
    if (ids.has(b.id)) issue(["buildings", i, "id"], "Duplicate building ID"); ids.add(b.id);
    if (!buildingTypes.has(b.type)) issue(["buildings", i, "type"], "Not a building block");
    inGrid(b.entrance, ["buildings", i, "entrance"]);
    const entranceX = b.entrance % s.size.w; const entranceZ = Math.floor(b.entrance / s.size.w);
    const hasExternalAccess = b.cells.some((cell) => Math.abs(cell % s.size.w - entranceX) + Math.abs(Math.floor(cell / s.size.w) - entranceZ) === 1);
    if (!b.cells.includes(b.entrance) && !hasExternalAccess) issue(["buildings", i, "entrance"], "Entrance must be in or adjacent to footprint");
    b.cells.forEach((cell, j) => {
      inGrid(cell, ["buildings", i, "cells", j]);
      if (occupied.has(cell)) issue(["buildings", i, "cells", j], "Overlapping footprint"); occupied.add(cell);
      if (s.blocks[cell] !== b.type) issue(["blocks", cell], "Block must match building footprint");
    });
  });
  s.blocks.forEach((type, cell) => {
    if (buildingTypes.has(type) && !occupied.has(cell)) issue(["blocks", cell], "Building block has no definition");
  });
  const districtIds = new Set<number>(); const districtCells = new Set<number>();
  s.districts.forEach((d, i) => {
    if (districtIds.has(d.id)) issue(["districts", i, "id"], "Duplicate district ID"); districtIds.add(d.id);
    d.cells.forEach((cell, j) => {
      inGrid(cell, ["districts", i, "cells", j]);
      if (districtCells.has(cell)) issue(["districts", i, "cells", j], "District cells overlap"); districtCells.add(cell);
    });
  });
  (["rain", "wind"] as const).forEach((key) => s.weather[key].forEach((point, i, points) => {
    if (i > 0 && point.t <= points[i - 1].t) issue(["weather", key, i, "t"], "Timeline ticks must strictly increase");
  }));
  s.weather.sources.forEach((source, i) => {
    inGrid(source.cell, ["weather", "sources", i, "cell"]);
    if (source.endT <= source.startT) issue(["weather", "sources", i, "endT"], "Source interval must be nonempty [startT,endT)");
  });
  const nodes = new Map(s.powerGrid.nodes.map((node) => [node.id, node]));
  if (nodes.size !== s.powerGrid.nodes.length) issue(["powerGrid", "nodes"], "Duplicate node ID");
  s.powerGrid.nodes.forEach((node, i) => {
    inGrid(node.cell, ["powerGrid", "nodes", i, "cell"]);
    if (node.building !== undefined && !ids.has(node.building)) issue(["powerGrid", "nodes", i, "building"], "Unknown building");
  });
  s.powerGrid.edges.forEach(([a, b], i) => {
    if (!nodes.has(a) || !nodes.has(b) || a === b) issue(["powerGrid", "edges", i], "Invalid power edge");
  });
  s.buildings.forEach((b, i) => {
    if (b.powerNode !== undefined && (!nodes.has(b.powerNode) || nodes.get(b.powerNode)?.building !== b.id)) issue(["buildings", i, "powerNode"], "Power node must refer back to building");
  });
  s.injected.forEach((event, i) => {
    if ("cell" in event) inGrid(event.cell, ["injected", i, "cell"]);
    if (event.kind === "substation_flooded" && nodes.get(event.nodeId)?.kind !== "substation") issue(["injected", i, "nodeId"], "Unknown substation");
    if (event.kind === "shelter_overflow" && !s.buildings.some((b) => b.id === event.buildingId && b.type === BlockType.Shelter)) issue(["injected", i, "buildingId"], "Unknown shelter");
    if (event.kind === "boat_failure") {
      const offset = s.fleet.ambulances + s.fleet.policeCars;
      if (event.vehicleId <= offset || event.vehicleId > offset + s.fleet.boats) issue(["injected", i, "vehicleId"], "Unknown boat ID in deterministic fleet ordering");
    }
  });
});

export const NpcParamsSchema: z.ZodType<NpcParams> = z.strictObject({
  panicMean: unit, complianceMean: unit, riskToleranceMean: unit, altruismMean: unit,
  awarenessMean: unit, carOwnership: unit, warningDelay: count, falseReportRate: unit,
  commsDelay: count, staffFatigueRate: unit,
});
const BuildingPlacementSchema = z.strictObject(buildingShape).superRefine((b, ctx) => {
  if (!buildingTypes.has(b.type)) ctx.addIssue({ code: "custom", path: ["type"], message: "Not a building block" });
  if (new Set(b.cells).size !== b.cells.length) ctx.addIssue({ code: "custom", path: ["cells"], message: "Duplicate footprint cells" });
  if (!b.cells.includes(b.entrance)) ctx.addIssue({ code: "custom", path: ["entrance"], message: "Entrance must be in footprint" });
});
export const PatchCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("setBlock"), cell: count, block, variant: count.optional() }),
  z.strictObject({ kind: z.literal("paintRect"), x0: count, z0: count, x1: count, z1: count, block }),
  z.strictObject({ kind: z.literal("setHeight"), cell: count, ground: count.max(255) }),
  z.strictObject({ kind: z.literal("placeBuilding"), def: BuildingPlacementSchema }),
  z.strictObject({ kind: z.literal("removeAt"), cell: count }),
  z.strictObject({ kind: z.literal("setPowerEdge"), a: count, b: count, on: z.boolean() }),
]);
export const ScenarioPatchSchema = z.strictObject({ title: z.string().min(1), rationale: z.string().min(1), commands: z.array(PatchCommandSchema).max(1024), estimatedCost: nonnegative });
export const EditCommandSchema = z.union([PatchCommandSchema, z.strictObject({ kind: z.literal("applyPatch"), patch: ScenarioPatchSchema })]);
const entityId = z.union([NpcIdSchema, VehicleIdSchema, BuildingIdSchema]);
export const SimEventSchema: z.ZodType<SimEvent> = z.strictObject({ tick: count, type: z.enum(SIM_EVENT_TYPES), actor: entityId.optional(), actorKind: z.enum(["npc", "vehicle", "building"]).optional(), target: z.union([entityId, RequestIdSchema]).optional(), targetKind: z.enum(["npc", "vehicle", "building", "request"]).optional(), cell: count.optional(), data: z.record(z.string(), z.union([finite, z.string(), z.boolean()])).optional(), reason: z.string().trim().min(1) });
export const MetricsFrameSchema: z.ZodType<MetricsFrame> = z.strictObject({
  tick: count, tts: z.strictObject({ mean: nonnegative, p50: nonnegative, p90: nonnegative }), unmet: count,
  idleFrac: z.record(z.string(), unit), gini: unit,
  hospitals: z.array(z.strictObject({ id: BuildingIdSchema, util: nonnegative, diversion: z.boolean(), onGenerator: z.boolean() })),
  evacDonePct: finite.min(0).max(100), stranded: count, gridlockCells: count,
  floodedCells: count, maxDepth: nonnegative, unpoweredPopPct: finite.min(0).max(100), heliRescues: count, routeViolations: count,
});
export const RunSummarySchema: z.ZodType<RunSummary> = z.strictObject({ scenario: z.string().min(1), seed: SeedSchema, mode: DispatchModeSchema, metrics: z.array(MetricsFrameSchema), events: z.array(SimEventSchema), hotspots: z.array(z.strictObject({ kind: z.enum(["gridlock", "isolated", "hospital_overload", "power"]), cells: z.array(count), score: nonnegative })) });
export const RunOptionsSchema = z.strictObject({ durationTicks: count.min(1).max(86400).optional(), metricsEvery: count.min(1).max(86400).optional(), startTimeSeconds: count.max(86399).optional(), npcParams: NpcParamsSchema.optional() });
export const MainToWorkerSchema: z.ZodType<MainToWorker> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("load"), scenario: ScenarioSchema, seed: SeedSchema, options: RunOptionsSchema.optional() }),
  ...(["play", "pause", "step", "exportLog"] as const).map((kind) => z.strictObject({ kind: z.literal(kind) })),
  z.strictObject({ kind: z.literal("setSpeed"), speed: z.union([z.literal(1), z.literal(4), z.literal(16)]) }),
  z.strictObject({ kind: z.literal("edit"), command: EditCommandSchema }),
  z.strictObject({ kind: z.literal("inject"), event: InjectedEventSchema }),
  z.strictObject({ kind: z.literal("setNpcParams"), params: NpcParamsSchema }),
  z.strictObject({ kind: z.literal("setDispatchMode"), mode: DispatchModeSchema }),
  z.strictObject({ kind: z.literal("seek"), tick: count }),
  z.strictObject({ kind: z.literal("inspect"), id: z.union([NpcIdSchema, VehicleIdSchema, BuildingIdSchema, count]), entityKind: z.enum(["npc", "vehicle", "building", "cell"]) }).superRefine((s, ctx) => {
    if (s.entityKind !== "cell" && (s.id === 0 || s.id > 0x7fffffff)) ctx.addIssue({ code: "custom", path: ["id"], message: "Entity ID must be a positive Int32" });
  }).transform((s) => s as Extract<MainToWorker, { kind: "inspect" }>),
]);

const inspectorShape = {
  title: z.string().min(1), attributes: z.record(z.string(), z.union([finite, z.string()])),
  assignment: z.strictObject({ requestId: RequestIdSchema, status: z.string(), eta: nonnegative }).optional(),
  route: z.strictObject({ cells: z.array(count), version: count }).optional(),
  belief: z.strictObject({ knownClosures: z.array(count), staleness: nonnegative }).optional(),
  lastDecision: z.strictObject({ tick: count, chosen: z.string(), alternatives: z.array(z.strictObject({ label: z.string(), score: finite })), reason: z.string().min(1) }).optional(),
};
export const InspectorDataSchema: z.ZodType<InspectorData> = z.discriminatedUnion("kind", [
  z.strictObject({ ...inspectorShape, kind: z.literal("npc"), id: NpcIdSchema }),
  z.strictObject({ ...inspectorShape, kind: z.literal("vehicle"), id: VehicleIdSchema }),
  z.strictObject({ ...inspectorShape, kind: z.literal("building"), id: BuildingIdSchema }),
  z.strictObject({ ...inspectorShape, kind: z.literal("cell"), id: count }),
]);
const f32 = z.instanceof(Float32Array).refine((a) => a.every(Number.isFinite), "Nonfinite array entries");
const u8 = z.instanceof(Uint8Array);
const i32 = z.instanceof(Int32Array).refine((a) => a.every((v) => v > 0) && new Set(a).size === a.length, "IDs must be unique positive Int32 values");
const enumArray = (max: number) => u8.refine((a) => a.every((v) => v <= max), "Unknown snapshot enum value");
export const RenderSnapshotSchema: z.ZodType<RenderSnapshot> = z.strictObject({
  tick: count, water: f32.refine((a) => a.every((v) => v >= 0)), powered: u8.refine((a) => a.every((v) => v <= 2)),
  npcs: z.strictObject({ id: i32, x: f32, z: f32, heading: f32, role: enumArray(NpcRole.Dispatcher), state: enumArray(NpcState.Rest) }),
  vehicles: z.strictObject({ id: i32, x: f32, z: f32, heading: f32, kind: enumArray(VehicleKind.Helicopter), state: enumArray(VehicleState.Refuelling) }),
  reports: z.strictObject({ x: f32, z: f32, confidence: f32.refine((a) => a.every((v) => v >= 0 && v <= 1)), status: enumArray(ReportStatus.False) }),
  dirtyChunks: z.array(count),
}).superRefine((s, ctx) => {
  if (s.water.length !== s.powered.length) ctx.addIssue({ code: "custom", path: ["powered"], message: "Grid array lengths differ" });
  for (const key of ["npcs", "vehicles", "reports"] as const) {
    const arrays = Object.values(s[key]);
    if (arrays.some((a) => a.length !== arrays[0].length)) ctx.addIssue({ code: "custom", path: [key], message: "Entity array lengths differ" });
  }
});
export const WorkerToMainSchema: z.ZodType<WorkerToMain> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("snapshot"), snapshot: RenderSnapshotSchema }),
  z.strictObject({ kind: z.literal("events"), events: z.array(SimEventSchema) }),
  z.strictObject({ kind: z.literal("metrics"), metrics: MetricsFrameSchema }),
  z.strictObject({ kind: z.literal("done"), summary: RunSummarySchema }),
  z.strictObject({ kind: z.literal("inspector"), inspector: InspectorDataSchema }),
  z.strictObject({ kind: z.literal("error"), message: z.string().min(1) }),
]);
