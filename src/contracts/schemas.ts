import { z } from 'zod';
import { BlockType } from './blocks';
import type { EditCommand, ScenarioPatch } from './edit';
import { SIM_EVENT_TYPES, type SimEvent } from './events';
import type { BuildingId, NpcId, RequestId, VehicleId } from './ids';
import type { InspectorData } from './inspector';
import type { MetricsFrame, RunSummary } from './metrics';
import type { NpcParams } from './params';
import type { BuildingDef, InjectedEvent, Scenario } from './scenario';

const int = z.number().int();
const nonNeg = z.number().int().nonnegative();
const unit = z.number().min(0).max(1);

const buildingId = nonNeg.transform((n) => n as BuildingId);
const entityId = nonNeg.transform((n) => n as NpcId | VehicleId | BuildingId);
const targetId = nonNeg.transform((n) => n as NpcId | VehicleId | BuildingId | RequestId);
const requestId = nonNeg.transform((n) => n as RequestId);

export const BlockTypeSchema = z.enum(BlockType);
export const DispatchModeSchema = z.enum(['negotiation', 'centralised']);

export const BuildingDefSchema: z.ZodType<BuildingDef> = z.object({
  id: buildingId,
  type: BlockTypeSchema,
  cells: z.array(nonNeg).min(1),
  capacity: nonNeg,
  entrance: nonNeg,
  floorHeight: z.number().nonnegative(),
  generator: z.object({ fuelTicks: nonNeg }).optional(),
  helipad: z.boolean().optional(),
  powerNode: nonNeg.optional(),
});

export const InjectedEventSchema: z.ZodType<InjectedEvent> = z.object({
  t: nonNeg,
  kind: z.enum([
    'bridge_closed',
    'boat_failure',
    'shelter_overflow',
    'substation_flooded',
    'road_blocked_by_debris',
    'false_report',
    'comms_outage',
    'helicopter_grounded_wind',
  ]),
  cell: nonNeg.optional(),
  target: nonNeg.optional(),
  durationTicks: nonNeg.optional(),
});

export const ScenarioSchema: z.ZodType<Scenario> = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1),
    size: z.object({ w: int.min(8).max(256), h: int.min(8).max(256) }),
    ground: z.array(int.min(0).max(255)),
    blocks: z.array(BlockTypeSchema),
    buildings: z.array(BuildingDefSchema),
    districts: z.array(z.object({ id: nonNeg, name: z.string(), cells: z.array(nonNeg) })),
    population: z.object({
      count: nonNeg,
      mix: z.object({ carOwners: unit, limitedMobility: unit, needsAssist: unit }),
      schedule: z.enum(['office-hours', 'night', 'custom']),
    }),
    fleet: z.object({
      ambulances: nonNeg,
      policeCars: nonNeg,
      boats: nonNeg,
      helicopters: nonNeg,
      doctors: nonNeg,
      nurses: nonNeg,
      policeOfficers: nonNeg,
      boatOperators: nonNeg,
    }),
    weather: z.object({
      rain: z.array(z.object({ t: nonNeg, intensity: unit })),
      wind: z.array(z.object({ t: nonNeg, speed: unit })),
      floodKind: z.enum(['growing', 'flash', 'compound']),
      sources: z.array(
        z.object({ cell: nonNeg, startT: nonNeg, endT: nonNeg, rate: z.number().nonnegative() }),
      ),
      warningDelay: nonNeg,
    }),
    injected: z.array(InjectedEventSchema),
    powerGrid: z.object({
      nodes: z.array(
        z.object({
          id: nonNeg,
          kind: z.enum(['plant', 'substation', 'load']),
          cell: nonNeg,
          building: buildingId.optional(),
        }),
      ),
      edges: z.array(z.tuple([nonNeg, nonNeg])),
    }),
    defaults: z.object({ dispatchMode: DispatchModeSchema, seed: nonNeg }),
  })
  .superRefine((s, ctx) => {
    const n = s.size.w * s.size.h;
    if (s.ground.length !== n) {
      ctx.addIssue({ code: 'custom', path: ['ground'], message: `expected ${n} cells, got ${s.ground.length}` });
    }
    if (s.blocks.length !== n) {
      ctx.addIssue({ code: 'custom', path: ['blocks'], message: `expected ${n} cells, got ${s.blocks.length}` });
    }
    const outOfGrid = (c: number) => c >= n;
    s.buildings.forEach((b, i) => {
      if (b.cells.some(outOfGrid) || outOfGrid(b.entrance)) {
        ctx.addIssue({ code: 'custom', path: ['buildings', i], message: 'cell outside the grid' });
      }
    });
    s.districts.forEach((d, i) => {
      if (d.cells.some(outOfGrid)) {
        ctx.addIssue({ code: 'custom', path: ['districts', i], message: 'cell outside the grid' });
      }
    });
    s.weather.sources.forEach((src, i) => {
      if (outOfGrid(src.cell)) {
        ctx.addIssue({ code: 'custom', path: ['weather', 'sources', i], message: 'cell outside the grid' });
      }
    });
    const nodeIds = new Set(s.powerGrid.nodes.map((p) => p.id));
    s.powerGrid.edges.forEach(([a, b], i) => {
      if (!nodeIds.has(a) || !nodeIds.has(b)) {
        ctx.addIssue({ code: 'custom', path: ['powerGrid', 'edges', i], message: 'unknown power node' });
      }
    });
  });

export const NpcParamsSchema: z.ZodType<NpcParams> = z.object({
  panicMean: unit,
  complianceMean: unit,
  riskToleranceMean: unit,
  altruismMean: unit,
  awarenessMean: unit,
  carOwnership: unit,
  warningDelay: nonNeg,
  falseReportRate: unit,
  commsDelay: nonNeg,
  staffFatigueRate: unit,
});

const BuildingDefNoIdSchema = z.object({
  type: BlockTypeSchema,
  cells: z.array(nonNeg).min(1),
  capacity: nonNeg,
  entrance: nonNeg,
  floorHeight: z.number().nonnegative(),
  generator: z.object({ fuelTicks: nonNeg }).optional(),
  helipad: z.boolean().optional(),
  powerNode: nonNeg.optional(),
});

export const EditCommandSchema: z.ZodType<EditCommand> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('setBlock'), cell: nonNeg, block: BlockTypeSchema, variant: nonNeg.optional() }),
    z.object({
      kind: z.literal('paintRect'),
      x0: nonNeg,
      z0: nonNeg,
      x1: nonNeg,
      z1: nonNeg,
      block: BlockTypeSchema,
    }),
    z.object({ kind: z.literal('setHeight'), cell: nonNeg, ground: int.min(0).max(255) }),
    z.object({ kind: z.literal('placeBuilding'), def: BuildingDefNoIdSchema }),
    z.object({ kind: z.literal('removeAt'), cell: nonNeg }),
    z.object({ kind: z.literal('setPowerEdge'), a: nonNeg, b: nonNeg, on: z.boolean() }),
    z.object({ kind: z.literal('applyPatch'), patch: ScenarioPatchSchema }),
  ]),
);

export const ScenarioPatchSchema: z.ZodType<ScenarioPatch> = z.lazy(() =>
  z.object({
    title: z.string(),
    rationale: z.string(),
    commands: z.array(EditCommandSchema),
    estimatedCost: z.number().nonnegative(),
  }),
);

export const SimEventSchema: z.ZodType<SimEvent> = z.object({
  tick: nonNeg,
  type: z.enum(SIM_EVENT_TYPES),
  actor: entityId.optional(),
  actorKind: z.enum(['npc', 'vehicle', 'building']).optional(),
  target: targetId.optional(),
  targetKind: z.enum(['npc', 'vehicle', 'building', 'request']).optional(),
  cell: nonNeg.optional(),
  data: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
  reason: z.string().min(1),
});

export const MetricsFrameSchema: z.ZodType<MetricsFrame> = z.object({
  tick: nonNeg,
  tts: z.object({ mean: z.number(), p50: z.number(), p90: z.number() }),
  unmet: nonNeg,
  idleFrac: z.record(z.string(), unit),
  gini: unit,
  hospitals: z.array(
    z.object({ id: buildingId, util: z.number().nonnegative(), diversion: z.boolean(), onGenerator: z.boolean() }),
  ),
  evacDonePct: z.number().min(0).max(100),
  stranded: nonNeg,
  gridlockCells: nonNeg,
  floodedCells: nonNeg,
  maxDepth: z.number().nonnegative(),
  unpoweredPopPct: z.number().min(0).max(100),
  heliRescues: nonNeg,
  routeViolations: nonNeg,
});

export const RunSummarySchema: z.ZodType<RunSummary> = z.object({
  scenario: z.string(),
  seed: nonNeg,
  mode: DispatchModeSchema,
  metrics: z.array(MetricsFrameSchema),
  events: z.array(SimEventSchema),
  hotspots: z.array(
    z.object({
      kind: z.enum(['gridlock', 'isolated', 'hospital_overload', 'power']),
      cells: z.array(nonNeg),
      score: z.number(),
    }),
  ),
});

export const InspectorDataSchema: z.ZodType<InspectorData> = z.object({
  id: int,
  kind: z.enum(['npc', 'vehicle', 'building', 'cell']),
  title: z.string(),
  attributes: z.record(z.string(), z.union([z.number(), z.string()])),
  assignment: z.object({ requestId, status: z.string(), eta: z.number() }).optional(),
  route: z.object({ cells: z.array(nonNeg), version: nonNeg }).optional(),
  belief: z.object({ knownClosures: z.array(nonNeg), staleness: z.number() }).optional(),
  lastDecision: z
    .object({
      tick: nonNeg,
      chosen: z.string(),
      alternatives: z.array(z.object({ label: z.string(), score: z.number() })),
      reason: z.string(),
    })
    .optional(),
});
