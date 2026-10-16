import { BlockType, type RunSummary } from '../contracts';
import type { Analysis } from './analysers';
import type { CityIndex } from './cityIndex';
import { BUDGET_TIERS, CELL_COST, CRITIC_BLOCKS, CRITIC_FACILITIES, DEFAULT_BUDGET, FACILITY_COST } from './patchCompiler';
import { scoreRun } from './score';

export const TOKEN_BUDGET = 6000;

/** Rough token count for English plus JSON punctuation (≈ 3.6 characters per token). */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3.6);

export interface EvidencePack {
  legend: string[];
  city: {
    name: string;
    sizeCells: [number, number];
    sizeMetres: [number, number];
    districts: string[];
    landmarks: { name: string; type: string; at: string; capacity?: number }[];
    fleet: Record<string, number>;
    population: number;
  };
  run: {
    seed: number;
    dispatchMode: string;
    durationMinutes: number;
    final: Record<string, number>;
    trajectory: { minute: number; flooded: number; stranded: number; unpoweredPct: number; unmet: number; gridlock: number }[];
    injected: string[];
    /** City resilience score 0..100 and its parts; the goal is to raise it. */
    score: { total: number; grade: string; parts: { part: string; score: number; weight: number; why: string }[] };
  };
  floodRules: string[];
  findings: { id: string; severity: string; title: string; explanation: string; cells: { cell: number; where: string }[]; ticks: number[] }[];
  allowedChanges: {
    blocks: string[];
    facilities: string[];
    budget: number;
    budgetTiers: typeof BUDGET_TIERS;
    eco: boolean;
    costPerCell: Record<string, number>;
    facilityCost: Record<string, number>;
    gridIndex: string;
  };
  miniMap?: string[];
}

const LEGEND = [
  'Synthetic city. 1 cell = 4 m square; 1 voxel of height = 1 m. 1 tick = 1 simulated second.',
  'Cell index i = z * width + x. Coordinates are written (x, z).',
  'tts = time to service (seconds from a request to help arriving). unmet = open requests. gini: 0 equal, 1 unequal.',
  'Mini-map: ~ water, = road, # closed road, H hospital, S shelter, P power, D drain, ! finding cell, . ground.',
];

/** How the simulated flood responds to planning, so proposals use levers that work in this model. */
export const FLOOD_RULES = [
  'Rain runs off paved ground and roofs (90%), rock (70%), dirt (50%), grass (30%) and trees (15%). The river rises faster when more of the city is paved.',
  'Green ground soaks ponded water: trees 25 mm/h, grass 15 mm/h, paved 0. Planting trees in a catchment lowers both street ponding and the river peak.',
  'River water floods every connected cell lower than the river level. A levee raises the bank by 3 m but only works as an unbroken line; water flows around its ends.',
  'A storm drain empties the hollow it sits in: 0.05 m³/s when its area has power, 30% on gravity, and nothing once the river is above its outlet. Drains only help at the low point of a hollow.',
  'Homes take water once it is 0.5 m deep at the door. Substations trip at 0.4 m and black out their whole area, which also stops drain pumps and traffic signals.',
  'Cars stall above 0.3 m. A bridge keeps a crossing open until the river tops its deck. Helipads let helicopters reach rooftops when roads are under water.',
];

export function buildEvidencePack(
  run: RunSummary,
  city: CityIndex,
  analyses: readonly Analysis[],
  opts: { budget?: number; eco?: boolean; tokenBudget?: number; miniMap?: boolean } = {},
): EvidencePack {
  const { scenario, w, h } = city;
  const last = run.metrics.at(-1);
  const step = Math.max(1, Math.ceil(run.metrics.length / 10));
  const score = scoreRun(run, scenario);
  const pack: EvidencePack = {
    legend: LEGEND,
    city: {
      name: scenario.name,
      sizeCells: [w, h],
      sizeMetres: [w * 4, h * 4],
      districts: scenario.districts.map((d) => d.name),
      landmarks: scenario.buildings
        .filter((b) => [BlockType.Hospital, BlockType.Shelter, BlockType.FloodHQ, BlockType.Substation, BlockType.PowerPlant, BlockType.BoatDepot, BlockType.Helipad].includes(b.type))
        .slice(0, 24)
        .map((b) => ({ name: city.names.get(b.id) ?? `#${b.id}`, type: BlockType[b.type], at: city.describe(b.entrance, false), ...(b.capacity ? { capacity: b.capacity } : {}) })),
      fleet: { ...scenario.fleet },
      population: scenario.population.count,
    },
    run: {
      seed: run.seed,
      dispatchMode: run.mode,
      durationMinutes: Math.round((last?.tick ?? 0) / 60),
      final: last
        ? {
            ttsMean: Math.round(last.tts.mean),
            ttsP90: Math.round(last.tts.p90),
            unmet: last.unmet,
            gini: last.gini,
            evacDonePct: Math.round(last.evacDonePct),
            stranded: last.stranded,
            floodedCells: last.floodedCells,
            maxDepthM: last.maxDepth,
            unpoweredPopPct: Math.round(last.unpoweredPopPct),
            heliRescues: last.heliRescues,
            routeViolations: last.routeViolations,
            ...(last.homesFlooded !== undefined ? { homesFlooded: last.homesFlooded, residentsAffected: last.residentsAffected ?? 0 } : {}),
            ...(last.roadsClosedPct !== undefined ? { roadsClosedPct: last.roadsClosedPct } : {}),
          }
        : {},
      trajectory: run.metrics
        .filter((_, i) => i % step === 0)
        .map((m) => ({ minute: Math.round(m.tick / 60), flooded: m.floodedCells, stranded: m.stranded, unpoweredPct: Math.round(m.unpoweredPopPct), unmet: m.unmet, gridlock: m.gridlockCells })),
      injected: run.events.filter((e) => e.type === 'INJECTED').slice(0, 10).map((e) => `minute ${Math.round(e.tick / 60)}: ${e.reason}`),
      score: { total: score.total, grade: score.grade, parts: score.parts.map((p) => ({ part: p.label, score: p.score, weight: p.weight, why: p.detail })) },
    },
    floodRules: FLOOD_RULES,
    findings: analyses.flatMap((a) =>
      a.findings.map((f) => {
        const cells = f.evidence.flatMap((e) => e.cells ?? []);
        return { id: f.id, severity: f.severity, title: f.title, explanation: f.explanation, cells: cells.slice(0, 8).map((c) => ({ cell: c, where: city.describe(c) })), ticks: f.evidence.flatMap((e) => e.eventTicks ?? []).slice(0, 6) };
      }),
    ),
    allowedChanges: {
      blocks: CRITIC_BLOCKS.map((b) => `${BlockType[b]} (${b})`),
      facilities: CRITIC_FACILITIES.map(
        (t) =>
          `placeBuilding { type: ${t} (${BlockType[t]}), cells: compact free footprint, entrance: one of them${t === BlockType.Helipad ? ', max 4 cells' : ''} }`,
      ),
      budget: opts.budget ?? DEFAULT_BUDGET,
      budgetTiers: BUDGET_TIERS,
      eco: !!opts.eco,
      costPerCell: Object.fromEntries(Object.entries(CELL_COST).map(([k, v]) => [BlockType[Number(k)], v])),
      facilityCost: Object.fromEntries(Object.entries(FACILITY_COST).map(([k, v]) => [BlockType[Number(k)], v])),
      gridIndex: `cell = z * ${w} + x, 0 <= x < ${w}, 0 <= z < ${h}`,
    },
  };
  if (opts.miniMap !== false) pack.miniMap = miniMap(run, city, analyses);
  return fitBudget(pack, opts.tokenBudget ?? TOKEN_BUDGET);
}

/** Drops the least useful detail until the pack fits the token budget. */
function fitBudget(pack: EvidencePack, budget: number): EvidencePack {
  const size = () => estimateTokens(JSON.stringify(pack));
  if (size() > budget) delete pack.miniMap;
  while (size() > budget && pack.city.landmarks.length > 6) pack.city.landmarks.pop();
  while (size() > budget && pack.run.trajectory.length > 4) pack.run.trajectory = pack.run.trajectory.filter((_, i) => i % 2 === 0);
  for (const f of pack.findings) if (size() > budget) f.cells = f.cells.slice(0, 3);
  while (size() > budget && pack.findings.length > 3) pack.findings.pop();
  return pack;
}

/** ≤ 48×48 downsampled map of water, roads, closures, civic sites and finding cells. */
export function miniMap(run: RunSummary, city: CityIndex, analyses: readonly Analysis[], max = 48): string[] {
  const { scenario, w, h } = city;
  const k = Math.max(1, Math.ceil(Math.max(w, h) / max));
  const closed = new Set<number>();
  for (const e of run.events) if (e.cell !== undefined && (e.type === 'ROAD_CLOSED' || e.type === 'BRIDGE_OVERTOPPED')) closed.add(e.cell);
  const marked = new Set(analyses.flatMap((a) => a.findings.flatMap((f) => f.evidence.flatMap((e) => e.cells ?? []))));
  const RANK: [string, (c: number) => boolean][] = [
    ['!', (c) => marked.has(c)],
    ['H', (c) => scenario.blocks[c] === BlockType.Hospital],
    ['S', (c) => scenario.blocks[c] === BlockType.Shelter],
    ['P', (c) => scenario.blocks[c] === BlockType.Substation || scenario.blocks[c] === BlockType.PowerPlant],
    ['#', (c) => closed.has(c)],
    ['D', (c) => scenario.blocks[c] === BlockType.Drainage],
    ['~', (c) => scenario.blocks[c] === BlockType.WaterSource],
    ['=', (c) => scenario.blocks[c] === BlockType.Road || scenario.blocks[c] === BlockType.Bridge],
  ];
  const rows: string[] = [];
  for (let z0 = 0; z0 < h; z0 += k) {
    let row = '';
    for (let x0 = 0; x0 < w; x0 += k) {
      let best = RANK.length;
      for (let z = z0; z < Math.min(h, z0 + k); z++)
        for (let x = x0; x < Math.min(w, x0 + k); x++) {
          const c = z * w + x;
          const r = RANK.findIndex(([, test]) => test(c));
          if (r >= 0 && r < best) best = r;
        }
      row += best < RANK.length ? RANK[best][0] : '.';
    }
    rows.push(row);
  }
  return rows;
}
