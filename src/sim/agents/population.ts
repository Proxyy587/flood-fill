import { BlockType, NpcRole, NpcState, VehicleKind, VehicleState } from "../../contracts/types";
import type { Scenario, RunOptions, NpcParams, BuildingDef, NpcId, BuildingId, SimEvent } from "../../contracts/types";
import { ScenarioSchema, RunOptionsSchema } from "../../contracts/schemas";
import { createRng } from "../rng";

export interface NpcTable {
  id: Int32Array; role: Uint8Array; baseRole: Uint8Array; state: Uint8Array;
  cell: Int32Array; x: Float32Array; z: Float32Array; heading: Float32Array;
  home: Int32Array; homeBuilding: Int32Array; work: Int32Array; workBuilding: Int32Array;
  hasCar: Uint8Array; car: Int32Array; unhoused: Uint8Array; mobility: Uint8Array;
  speed: Float32Array; panic: Float32Array; compliance: Float32Array; riskTolerance: Float32Array;
  altruism: Float32Array; awareness: Float32Array; health: Float32Array; fatigue: Float32Array;
  departTick: Int32Array; workDuration: Int32Array; workUntil: Int32Array;
}
export interface CarTable {
  id: Int32Array; kind: Uint8Array; state: Uint8Array; cell: Int32Array; owner: Int32Array;
  x: Float32Array; z: Float32Array; heading: Float32Array;
}
export interface PopulationState { npcs: NpcTable; cars: CarTable; params: NpcParams; civilianCount: number; startTime: number; events: SimEvent[] }

export function defaultNpcParams(s: Scenario): NpcParams {
  return { panicMean: 0.2, complianceMean: 0.8, riskToleranceMean: 0.35, altruismMean: 0.5,
    awarenessMean: 0.7, carOwnership: s.population.mix.carOwners, warningDelay: s.weather.warningDelay,
    falseReportRate: 0.05, commsDelay: 3, staffFatigueRate: 0.00002 };
}

function capacityAllocator(buildings: BuildingDef[]) {
  const ordered = [...buildings].sort((a, b) => a.id - b.id);
  const remaining = Float64Array.from(ordered.map((b) => b.capacity)); let cursor = 0;
  return () => {
    while (cursor < ordered.length && remaining[cursor] === 0) cursor++;
    if (cursor === ordered.length) return undefined;
    remaining[cursor]--; return ordered[cursor];
  };
}
function closest(buildings: BuildingDef[], cell: number, width: number): BuildingDef | undefined {
  let best: BuildingDef | undefined; let distance = Infinity;
  for (const building of buildings) {
    const cost = Math.abs(cell % width - building.entrance % width) + Math.abs(Math.floor(cell / width) - Math.floor(building.entrance / width));
    if (cost < distance || cost === distance && building.id < (best?.id ?? Infinity)) { best = building; distance = cost; }
  }
  return best;
}

/** Initial state only. Changes to caller-owned arrays cannot affect another run. */
export function createPopulation(input: Scenario, seed: number, options: RunOptions = {}): PopulationState {
  const s = ScenarioSchema.parse(input); const parsed = RunOptionsSchema.parse(options);
  const rng = createRng(seed); const params = parsed.npcParams ?? defaultNpcParams(s);
  const civilianCount = s.population.count;
  const carCount = Math.round(civilianCount * params.carOwnership);
  const reserved = s.fleet.ambulances + s.fleet.policeCars + s.fleet.boats + s.fleet.helicopters;
  if (carCount + reserved > 10000) throw new RangeError("Per-run car ownership exceeds vehicle budget");
  const total = civilianCount + s.fleet.doctors + s.fleet.nurses + s.fleet.policeOfficers + s.fleet.boatOperators;
  const npcs: NpcTable = {
    id: new Int32Array(total), role: new Uint8Array(total), baseRole: new Uint8Array(total), state: new Uint8Array(total),
    cell: new Int32Array(total), x: new Float32Array(total), z: new Float32Array(total), heading: new Float32Array(total),
    home: new Int32Array(total), homeBuilding: new Int32Array(total), work: new Int32Array(total).fill(-1), workBuilding: new Int32Array(total),
    hasCar: new Uint8Array(total), car: new Int32Array(total).fill(-1), unhoused: new Uint8Array(total), mobility: new Uint8Array(total),
    speed: new Float32Array(total), panic: new Float32Array(total), compliance: new Float32Array(total), riskTolerance: new Float32Array(total),
    altruism: new Float32Array(total), awareness: new Float32Array(total), health: new Float32Array(total).fill(100), fatigue: new Float32Array(total),
    departTick: new Int32Array(total), workDuration: new Int32Array(total), workUntil: new Int32Array(total).fill(-1),
  };
  const cars: CarTable = { id: new Int32Array(carCount), kind: new Uint8Array(carCount).fill(VehicleKind.Car), state: new Uint8Array(carCount).fill(VehicleState.Idle), cell: new Int32Array(carCount), owner: new Int32Array(carCount), x: new Float32Array(carCount), z: new Float32Array(carCount), heading: new Float32Array(carCount) };
  const shuffle = (count: number) => {
    const values = Int32Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const old = values[i]; values[i] = values[j]; values[j] = old; }
    return values;
  };
  const owners = shuffle(civilianCount); for (let i = 0; i < carCount; i++) npcs.hasCar[owners[i]] = 1;
  const mobilityOrder = shuffle(civilianCount); let mobilityCursor = 0;
  for (let i = 0; i < Math.floor(civilianCount * s.population.mix.needsAssist); i++) npcs.mobility[mobilityOrder[mobilityCursor++]] = 2;
  for (let i = 0; i < Math.floor(civilianCount * s.population.mix.limitedMobility); i++) npcs.mobility[mobilityOrder[mobilityCursor++]] = 1;
  const housing = capacityAllocator(s.buildings.filter((b) => b.type === BlockType.House || b.type === BlockType.Apartment));
  const employment = capacityAllocator(s.buildings.filter((b) => b.type === BlockType.Office || b.type === BlockType.Shop));
  const entrances = new Set(s.buildings.map((b) => b.entrance));
  const traversable = new Set([BlockType.Grass, BlockType.Dirt, BlockType.Sand, BlockType.Rock, BlockType.Road, BlockType.Bridge, BlockType.Drainage, BlockType.Pole]);
  const fallback = s.blocks.findIndex((type, cell) => traversable.has(type) || entrances.has(cell));
  if (total > 0 && fallback < 0) throw new RangeError("Population has no walkable spawn cell");
  const startTime = parsed.startTimeSeconds ?? (s.population.schedule === "night" ? 71700 : s.population.schedule === "custom" ? 0 : 28500);
  const departure = s.population.schedule === "night" ? 72000 : s.population.schedule === "custom" ? s.population.customSchedule!.departAt : 28800;
  const duration = s.population.customSchedule?.workTicks ?? 28800;
  const sample = (mean: number) => Math.min(1, Math.max(0, mean + (rng.next() + rng.next() - 1) * 0.3));
  const roles: [NpcRole, number, BlockType][] = [[NpcRole.Doctor, s.fleet.doctors, BlockType.Hospital], [NpcRole.Nurse, s.fleet.nurses, BlockType.Hospital], [NpcRole.Police, s.fleet.policeOfficers, BlockType.PoliceStation], [NpcRole.BoatOperator, s.fleet.boatOperators, BlockType.BoatDepot]];
  let staffIndex = 0; const events: SimEvent[] = []; let carIndex = 0;
  for (let i = 0; i < total; i++) {
    let role = NpcRole.Civilian; let facility: BlockType | undefined;
    if (i >= civilianCount) {
      while (staffIndex < roles.length && roles[staffIndex][1] === 0) staffIndex++;
      role = roles[staffIndex][0]; facility = roles[staffIndex][2]; roles[staffIndex][1]--;
    }
    const home = housing(); const work = i < civilianCount ? employment() : closest(s.buildings.filter((b) => b.type === facility), home?.entrance ?? fallback, s.size.w);
    const homeCell = home?.entrance ?? work?.entrance ?? fallback;
    npcs.id[i] = i + 1; npcs.role[i] = role; npcs.baseRole[i] = role; npcs.state[i] = NpcState.AtHome;
    npcs.home[i] = homeCell; npcs.homeBuilding[i] = home?.id ?? 0; npcs.work[i] = work?.entrance ?? -1; npcs.workBuilding[i] = work?.id ?? 0;
    npcs.cell[i] = homeCell; npcs.x[i] = homeCell % s.size.w + 0.5; npcs.z[i] = Math.floor(homeCell / s.size.w) + 0.5; npcs.unhoused[i] = home === undefined ? 1 : 0;
    npcs.speed[i] = 0.6 + rng.next() * 0.8;
    npcs.panic[i] = sample(params.panicMean); npcs.compliance[i] = sample(params.complianceMean); npcs.riskTolerance[i] = sample(params.riskToleranceMean);
    npcs.altruism[i] = sample(params.altruismMean); npcs.awareness[i] = sample(params.awarenessMean);
    const jitter = s.population.schedule === "custom" ? 0 : Math.floor(rng.next() * 241) - 120;
    const staffOffset = i >= civilianCount && s.population.schedule !== "custom" ? -900 : 0;
    npcs.departTick[i] = Math.max(0, departure + staffOffset + jitter - startTime); npcs.workDuration[i] = duration;
    if (npcs.hasCar[i]) {
      npcs.car[i] = carIndex; cars.id[carIndex] = reserved + carIndex + 1; cars.owner[carIndex] = i;
      cars.cell[carIndex] = homeCell; cars.x[carIndex] = npcs.x[i]; cars.z[carIndex] = npcs.z[i]; carIndex++;
    }
    events.push({ tick: 0, type: "NPC_CREATED", actor: npcs.id[i] as NpcId, actorKind: "npc", ...(work ? { target: work.id as BuildingId, targetKind: "building" as const } : {}), cell: homeCell,
      data: { role, homeAssigned: home !== undefined, workAssigned: work !== undefined, hasCar: Boolean(npcs.hasCar[i]), unhoused: home === undefined },
      reason: home ? "Seeded NPC assigned within housing capacity" : "No housing capacity; NPC starts at workplace or walkable public fallback without a housing allocation" });
  }
  return { npcs, cars, params, civilianCount, startTime, events };
}
