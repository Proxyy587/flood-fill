import { expect, it } from "vitest";
import { BlockType, NpcState, VehicleState, NpcRole } from "../../contracts/types";
import { RenderSnapshotSchema } from "../../contracts/sim-schemas";
import type { BuildingId, NpcId, Scenario } from "../../contracts/types";
import { createWorld } from "../world/grid";
import { createPopulation } from "./population";
import { createAgentSystem, handoffRescuedCivilian, reserveRescuedShelter, stepAgents, agentSnapshot, inspectAgent } from "./system";
import { createTraffic } from "../traffic";
import { buildHazardGrid } from "../nav/hazards";
import { livingFixture } from "./living-fixture";

function town(cars = 0): Scenario {
  const s = livingFixture(); s.population = { count: 1, mix: { carOwners: cars, limitedMobility: 0, needsAssist: 0 }, schedule: "custom", customSchedule: { departAt: 0, workTicks: 5 } };
  s.fleet = { ambulances: 0, policeCars: 0, boats: 0, helicopters: 0, doctors: 0, nurses: 0, policeOfficers: 0, boatOperators: 0 };
  return s;
}
function setup(s: Scenario) {
  const w = createWorld(s); const p = createPopulation(s, 42); const a = createAgentSystem(p, w, s);
  const traffic = createTraffic(w); const blocked = new Uint8Array(w.water.length);
  return { w, p, a, traffic, blocked, step: (tick: number, policeControlled?: Uint8Array, escortGuidance?: ReadonlySet<number>, crowdGuidance?: Uint8Array) => stepAgents(a, w, s, tick, blocked, traffic, policeControlled, escortGuidance, crowdGuidance) };
}
it("reroutes an evacuation around a police-guided hotspot without changing its shelter reservation", () => {
  const s = town();
  const { a, p, step } = setup(s);
  a.intent[0] = 3; a.shelterAssignment[0] = 0; a.shelterRemaining[0]--;
  p.npcs.state[0] = NpcState.Evacuate;
  step(1);
  const original = a.routes.get(0)!;
  expect(original.goal).toBe(46);
  const start = original.cells[0];
  p.npcs.cell[0] = start; p.npcs.x[0] = start % 8 + 0.5; p.npcs.z[0] = Math.floor(start / 8) + 0.5;
  original.cursor = 1; original.progress = 0;
  const hotspot = original.cells[2];
  const guidance = new Uint8Array(64); guidance[hotspot] = 1;
  const events = step(2, undefined, undefined, guidance);
  const route = a.routes.get(0)!;
  expect(route.cells).not.toContain(hotspot);
  expect(route.goal).toBe(46);
  expect(a.intent[0]).toBe(3);
  expect(a.shelterAssignment[0]).toBe(0);
  expect(events.some((event) => event.type === "REROUTE" && /police crowd guidance/i.test(event.reason))).toBe(true);
});
it("rejects malformed police crowd guidance masks", () => {
  const short = setup(town());
  expect(() => short.step(1, undefined, undefined, new Uint8Array(63))).toThrow(RangeError);
  const nonBinary = setup(town()); const mask = new Uint8Array(64); mask[10] = 2;
  expect(() => nonBinary.step(1, undefined, undefined, mask)).toThrow(RangeError);
});
it("finishes a partial foot edge before applying changed crowd guidance", () => {
  const { a, p, w, step } = setup(town());
  a.intent[0] = 2; p.npcs.home[0] = 46; p.npcs.state[0] = NpcState.ReturnHome;
  step(1);
  const original = a.routes.get(0)!;
  const hotspot = original.cells[2]; const guidance = new Uint8Array(64); guidance[hotspot] = 1;
  const x = p.npcs.x[0]; const z = p.npcs.z[0];
  const beforeCell = p.npcs.cell[0];
  const events = step(2, undefined, undefined, guidance);
  expect(a.routes.get(0)).toBe(original);
  expect(events.some((event) => event.type === "REROUTE")).toBe(false);
  expect(Math.hypot(p.npcs.x[0] - x, p.npcs.z[0] - z)).toBeLessThanOrEqual(0.5);
  expect(p.npcs.cell[0]).toBe(beforeCell);
  let rerouted = false;
  for (let tick = 3; tick <= 15; tick++) {
    const routeBefore = a.routes.get(0)!;
    const wasMidEdge = routeBefore.progress > 0;
    const previousX = p.npcs.x[0]; const previousZ = p.npcs.z[0];
    const events = step(tick, undefined, undefined, guidance);
    const didReroute = events.some((event) => event.type === "REROUTE" && /police crowd guidance/i.test(event.reason));
    if (!rerouted && !didReroute) expect(a.routes.get(0)).toBe(original);
    if (didReroute) {
      expect(routeBefore.progress).toBe(0);
      rerouted = true;
    }
    expect(Math.hypot(p.npcs.x[0] - previousX, p.npcs.z[0] - previousZ)).toBeLessThanOrEqual(0.5);
    if (wasMidEdge && !didReroute && routeBefore === original) expect(a.routes.get(0)).toBe(original);
  }
  expect(rerouted).toBe(true);
  expect(a.routes.get(0)!.cells).not.toContain(hotspot);
  expect(w.water[hotspot]).toBe(0);
});
it("keeps police-guided routes within the live flood-safe foot graph", () => {
  const s = town(); const { a, p, w, step } = setup(s);
  a.intent[0] = 2; p.npcs.home[0] = 46; p.npcs.state[0] = NpcState.ReturnHome;
  step(1);
  const original = a.routes.get(0)!; original.progress = 0;
  const hotspot = original.cells[2]; w.water[hotspot] = 1;
  const guidance = new Uint8Array(w.water.length); guidance[hotspot] = 1;
  step(2, undefined, undefined, guidance);
  const passable = buildHazardGrid(w, s, "foot").passable;
  expect(a.routes.get(0)!.cells).not.toContain(hotspot);
  expect(a.routes.get(0)!.cells.every((cell) => passable[cell] === 1)).toBe(true);
});
it("does not repeatedly reroute when the only reachable route crosses guided cells", () => {
  const s = town(); const { a, p, w, step } = setup(s);
  const onlyRoute = [9, 10, 11, 19, 27, 35, 43, 44, 45, 46];
  w.water.fill(1);
  for (const cell of onlyRoute) w.water[cell] = 0;
  a.intent[0] = 3; a.shelterAssignment[0] = 0; a.shelterRemaining[0]--;
  p.npcs.state[0] = NpcState.Evacuate; p.npcs.cell[0] = 9;
  a.routes.set(0, { cells: onlyRoute.slice(), modes: onlyRoute.map(() => 0), cursor: 1, progress: 0, goal: 46, version: 1 });
  const guidance = new Uint8Array(w.water.length); guidance[11] = 1;
  const events = [...step(1, undefined, undefined, guidance), ...step(2, undefined, undefined, guidance)];
  const active = a.routes.get(0)!;
  expect(events.filter((event) => event.type === "REROUTE" && /police crowd guidance/i.test(event.reason))).toHaveLength(1);
  expect(active.goal).toBe(46);
  expect(active.cells).toEqual(onlyRoute);
  const passable = buildHazardGrid(w, s, "foot").passable;
  expect(Array.from(passable).every((value, cell) => value === Number(onlyRoute.includes(cell)))).toBe(true);
});
it("reroutes only for crowd-guidance cells changed in the current tick", () => {
  const { a, p, step } = setup(town());
  a.intent[0] = 2; p.npcs.home[0] = 20; p.npcs.state[0] = NpcState.ReturnHome;
  const historical = new Uint8Array(64); historical[20] = 1;
  a.routes.set(0, { cells: [9, 10, 11, 19, 20], modes: [0, 0, 0, 0, 0], cursor: 1, progress: 0, goal: 20, version: 1 });
  step(1, undefined, undefined, historical);
  const current = p.npcs.cell[0];
  a.routes.set(0, { cells: [current, 10, 11, 19, 20], modes: [0, 0, 0, 0, 0], cursor: 1, progress: 0, goal: 20, version: 2, guidanceVersion: a.guidanceVersion });
  const next = historical.slice(); next[21] = 1;
  const events = step(2, undefined, undefined, next);
  expect(events.some((event) => event.type === "REROUTE" && /crowd guidance/i.test(event.reason))).toBe(false);
});
it("replays police crowd-guided route decisions deterministically", () => {
  const replay = () => {
    const s = town(); const { a, p, step } = setup(s);
    a.intent[0] = 2; p.npcs.home[0] = 46; p.npcs.state[0] = NpcState.ReturnHome;
    step(1);
    const route = a.routes.get(0)!; route.progress = 0;
    const guidance = new Uint8Array(64); guidance[route.cells[2]] = 1;
    const events = step(2, undefined, undefined, guidance);
    return { cells: a.routes.get(0)!.cells, position: [p.npcs.x[0], p.npcs.z[0]], events: events.map((event) => [event.type, event.reason]) };
  };
  expect(replay()).toEqual(replay());
});
it("increases walking progress only while the assigned police escort is present", () => {
  const scenario = town();
  const ordinary = setup(scenario);
  const escorted = setup(scenario);
  for (const fixture of [ordinary, escorted]) {
    fixture.a.intent[0] = 2;
    fixture.p.npcs.home[0] = 10;
    fixture.p.npcs.state[0] = NpcState.ReturnHome;
    fixture.a.routes.set(0, { cells: [9, 10], modes: [0, 0], cursor: 1, progress: 0, goal: 10, version: 1 });
  }
  ordinary.step(1);
  escorted.step(1, undefined, new Set([0]));
  expect(escorted.p.npcs.x[0]).toBeGreaterThan(ordinary.p.npcs.x[0]);
  const later = setup(scenario);
  later.a.intent[0] = 2;
  later.p.npcs.home[0] = 10;
  later.p.npcs.state[0] = NpcState.ReturnHome;
  later.a.routes.set(0, { cells: [9, 10], modes: [0, 0], cursor: 1, progress: 0, goal: 10, version: 1 });
  later.step(1);
  expect(later.p.npcs.x[0]).toBe(ordinary.p.npcs.x[0]);
});
it("passes police traffic control through agent stepping only for unpowered intersections", () => {
  const s = town(); s.blocks[19] = BlockType.Road; s.blocks[35] = BlockType.Road;
  const uncontrolled = setup(s); uncontrolled.w.powered[27] = 0;
  uncontrolled.step(1);
  expect(uncontrolled.traffic.intersections[27]).toBe(1);
  expect(uncontrolled.traffic.capacity[27]).toBe(0.5);

  const controlled = setup(s); controlled.w.powered[27] = 0;
  const mask = new Uint8Array(controlled.w.water.length); mask[27] = 1;
  controlled.step(1, mask);
  expect(controlled.traffic.capacity[27]).toBe(0.8);

  const powered = setup(s); powered.w.powered[27] = 1;
  powered.step(1, mask);
  expect(powered.traffic.capacity[27]).toBe(1);
});
it("rejects malformed police masks through agent stepping", () => {
  const s = town(); s.blocks[19] = BlockType.Road; s.blocks[35] = BlockType.Road;
  const wrongLength = setup(s);
  expect(() => wrongLength.step(1, new Uint8Array(wrongLength.w.water.length - 1))).toThrow(RangeError);

  const nonBinary = setup(s); const mask = new Uint8Array(nonBinary.w.water.length); mask[27] = 2;
  expect(() => nonBinary.step(1, mask)).toThrow(RangeError);
});
it("walks to work and returns without teleporting or repeating arrivals", () => {
  const s = town(); const { p, step } = setup(s); const events = [];
  let x = p.npcs.x[0]; let z = p.npcs.z[0];
  for (let tick = 1; tick <= 60; tick++) {
    events.push(...step(tick));
    expect(Math.hypot(p.npcs.x[0] - x, p.npcs.z[0] - z)).toBeLessThanOrEqual(0.5);
    x = p.npcs.x[0]; z = p.npcs.z[0];
  }
  expect(p.npcs.cell[0]).toBe(9); expect(p.npcs.state[0]).toBe(NpcState.AtHome);
  expect(events.filter((e) => e.type === "ARRIVED")).toHaveLength(2);
  expect(events.every((e) => e.reason.length > 0)).toBe(true);
});
it("does not teleport to an unreachable workplace and retries after a path opens", () => {
  const s = town(); const { p, blocked, step } = setup(s); blocked.fill(1); blocked[9] = 0;
  for (let tick = 1; tick <= 20; tick++) step(tick);
  expect(p.npcs.cell[0]).toBe(9); expect(p.npcs.state[0]).toBe(NpcState.SeekHelp);
  blocked.fill(0); for (let tick = 21; tick <= 60; tick++) step(tick);
  expect(p.npcs.state[0]).toBe(NpcState.AtHome);
});
it("reroutes a walking agent when a future route cell closes", () => {
  const s = town(); const { a, p, w, blocked, step } = setup(s);
  step(1); const route = a.routes.get(0)!;
  const future = route.cells.at(-1)!; blocked[future] = 1;
  const events = []; for (let tick = 2; tick <= 12; tick++) events.push(...step(tick));
  expect(events.some((e) => e.type === "REROUTE" && e.actorKind === "npc")).toBe(true);
  expect(p.npcs.cell[0]).not.toBe(future);
  expect(w.water.every((v) => v === 0)).toBe(true);
});
it("moves a civilian car on roads then parks it before entering a building", () => {
  const s = town(1); s.buildings[2].cells = [23]; s.buildings[2].entrance = 23;
  s.blocks[18] = BlockType.Grass; s.blocks[23] = BlockType.Office;
  // Adjacent long road commute makes driving faster than walking.
  s.blocks[10] = BlockType.Road; s.blocks[11] = BlockType.Road; s.blocks[12] = BlockType.Road; s.blocks[13] = BlockType.Road; s.blocks[21] = BlockType.Road;
  const { p, step } = setup(s); let drove = false;
  for (let tick = 1; tick <= 100; tick++) { step(tick); if (p.cars.state[0] === VehicleState.Moving || p.npcs.role[0] === NpcRole.Driver) drove = true; }
  expect(drove).toBe(true); expect(p.npcs.state[0]).toBe(NpcState.AtHome);
  expect(s.blocks[p.cars.cell[0]]).toBe(BlockType.Road);
});
it("stalls cars when their current road floods and never enters a deep next cell", () => {
  const s = town(1); const { p, w, step } = setup(s);
  w.water[p.cars.cell[0]] = 0.4;
  const events = step(1);
  expect(p.cars.state[0]).toBe(VehicleState.Failed);
  expect(events.filter((e) => e.type === "VEHICLE_STALLED")).toHaveLength(1);
  expect(step(2).some((e) => e.type === "VEHICLE_STALLED")).toBe(false);
});
it("snapshots and inspector data do not expose live buffers", () => {
  const s = town(); const { a, p, w, step } = setup(s); step(1);
  const snapshot = agentSnapshot(a); snapshot.npcs.x[0] = 99;
  expect(p.npcs.x[0]).not.toBe(99);
  const inspector = inspectAgent(a, { kind: "npc", id: 1 as NpcId });
  expect(inspector?.kind).toBe("npc"); expect(inspector?.lastDecision?.reason.length).toBeGreaterThan(0);
  expect(RenderSnapshotSchema.safeParse({ tick: 1, water: w.water, powered: w.powered, ...agentSnapshot(a), reports: { x: new Float32Array(), z: new Float32Array(), confidence: new Float32Array(), status: new Uint8Array() }, dirtyChunks: [] }).success).toBe(true);
});
it("reassigns medical staff to a reachable working hospital after power loss", () => {
  const s = town(); s.fleet.doctors = 1; s.population.count = 0;
  s.blocks[16] = BlockType.Hospital; s.buildings.push({ id: 5 as BuildingId, type: BlockType.Hospital, cells: [16], entrance: 16, capacity: 2, floorHeight: 1 });
  const { p, w, step } = setup(s); w.powered[14] = 0; w.powered[16] = 1;
  for (let tick = 1; tick <= 30; tick++) step(tick);
  expect(p.npcs.work[0]).toBe(16);
});
it("reopens shelter capacity when floodwater recedes and retries stranded civilians", () => {
  const s = town(); s.buildings.find((building) => building.type === BlockType.Shelter)!.capacity = 1;
  const { a, p, w, step } = setup(s);
  p.npcs.panic[0] = 1; p.npcs.compliance[0] = 1; p.npcs.riskTolerance[0] = 1; w.water[9] = 0.3;
  const first = step(1); expect(first.some((event) => event.type === "EVAC_ORDER")).toBe(true);
  w.water[46] = 2; step(2);
  expect(p.npcs.state[0]).toBe(NpcState.Stranded);
  w.water[46] = 0;
  const recovery: ReturnType<typeof step> = [];
  for (let tick = 3; tick <= 12; tick++) recovery.push(...step(tick));
  expect(recovery.some((event) => event.type === "EVAC_ORDER")).toBe(true);
  expect(a.shelterRemaining[0]).toBe(0);
});
it("evicts a sheltered civilian when floodwater makes the shelter unsafe", () => {
  const s = town(); s.buildings.find((building) => building.type === BlockType.Shelter)!.capacity = 1;
  const { a, p, w, step } = setup(s);
  p.npcs.panic[0] = 1; p.npcs.compliance[0] = 1; p.npcs.riskTolerance[0] = 1; w.water[9] = 0.3;
  for (let tick = 1; tick <= 30; tick++) step(tick);
  expect(p.npcs.state[0]).toBe(NpcState.ShelterInPlace);
  w.water[46] = 2;
  step(31);
  expect(p.npcs.state[0]).toBe(NpcState.Stranded);
  expect(a.shelterAssignment[0]).toBe(-1);
});
it("atomically assigns a boat-rescued civilian to reachable shelter capacity", () => {
  const s = town(); s.buildings.find((building) => building.type === BlockType.Shelter)!.capacity = 1;
  const { a, p, w, blocked } = setup(s);
  expect(handoffRescuedCivilian(a, 0, 24, w, s, blocked, true)).toBe(true);
  expect(a.shelterAssignment[0]).toBe(0);
  expect(p.npcs.state[0]).toBe(NpcState.Evacuate);
  expect(p.npcs.cell[0]).toBe(24);
  expect(handoffRescuedCivilian(a, 0, 24, w, s, blocked, true)).toBe(true);
  expect(a.shelterAssignment.filter((shelter) => shelter === 0)).toHaveLength(1);
});
it("does not overbook a shelter when multiple boat passengers reserve before boarding", () => {
  const s = town(); s.population.count = 2; s.buildings.find((building) => building.type === BlockType.Shelter)!.capacity = 1;
  const { a, w, blocked } = setup(s);
  expect(reserveRescuedShelter(a, 0, 24, w, s, blocked)).toBe(true);
  expect(reserveRescuedShelter(a, 1, 24, w, s, blocked)).toBe(false);
  expect(Array.from(a.shelterAssignment).filter((assignment) => assignment === 0)).toHaveLength(1);
});
it("returns an uninjured boat-rescued civilian toward a safe assigned home", () => {
  const s = town();
  const { a, p, w, blocked } = setup(s);
  expect(handoffRescuedCivilian(a, 0, 24, w, s, blocked, false)).toBe(true);
  expect(p.npcs.state[0]).toBe(NpcState.ReturnHome);
  expect(p.npcs.cell[0]).toBe(24);
});
it("marks an interrupted edge stranded, holds position and resumes without teleporting", () => {
  const { p, a, blocked, step } = setup(town()); step(1);
  const target = a.routes.get(0)!.cells[1]; const x = p.npcs.x[0]; const z = p.npcs.z[0];
  blocked[target] = 1; step(2);
  expect(p.npcs.state[0]).toBe(NpcState.Stranded); expect(p.npcs.x[0]).toBe(x); expect(p.npcs.z[0]).toBe(z);
  blocked[target] = 0; step(3);
  expect(Math.hypot(p.npcs.x[0] - x, p.npcs.z[0] - z)).toBeLessThan(0.5);
  for (let t = 4; t <= 60; t++) step(t);
  expect(p.npcs.state[0]).toBe(NpcState.AtHome);
});
it("does not reset a medical worker mid-edge when its workplace loses power", () => {
  const s = town(); s.fleet.doctors = 1; s.population.count = 0;
  s.blocks[16] = BlockType.Hospital; s.buildings.push({ id: 5 as BuildingId, type: BlockType.Hospital, cells: [16], entrance: 16, capacity: 2, floorHeight: 1 });
  const { p, w, step } = setup(s); w.powered[14] = 1; w.powered[16] = 1; step(1);
  const before = [p.npcs.x[0], p.npcs.z[0]];
  w.powered[14] = 0;
  for (let t = 2; t <= 40; t++) {
    step(t); expect(Math.hypot(p.npcs.x[0] - before[0], p.npcs.z[0] - before[1])).toBeLessThan(0.5);
    before[0] = p.npcs.x[0]; before[1] = p.npcs.z[0];
  }
  expect(p.npcs.work[0]).toBe(16);
});
it("retains the daily departure clock after returning home", () => {
  const { p, step } = setup(town());
  for (let t = 1; t <= 60; t++) step(t);
  expect(p.npcs.departTick[0]).toBe(86400);
});
it("rejects skipped or repeated agent ticks without advancing state", () => {
  const { a, step } = setup(town()); expect(() => step(2)).toThrow(/consecutive/);
  expect(a.lastTick).toBe(0); step(1); expect(() => step(1)).toThrow(/consecutive/);
});
it("never consumes later driving edges after its car fails mid-edge", () => {
  const s = town(1); s.buildings[2].cells = [23]; s.buildings[2].entrance = 23;
  s.blocks[18] = BlockType.Grass; s.blocks[23] = BlockType.Office;
  for (const cell of [10, 11, 12, 13, 21]) s.blocks[cell] = BlockType.Road;
  const { p, w, step } = setup(s);
  for (let t = 1; t <= 3; t++) step(t);
  w.water[11] = 0.4;
  for (let t = 4; t <= 30; t++) {
    const x = p.npcs.x[0]; const z = p.npcs.z[0]; step(t);
    expect(p.cars.state[0]).toBe(VehicleState.Failed);
    expect(p.npcs.role[0]).not.toBe(NpcRole.Driver);
    expect(Math.hypot(p.npcs.x[0] - x, p.npcs.z[0] - z)).toBeLessThanOrEqual(p.npcs.speed[0] * 0.35 + 0.000001);
  }
});
it.each(["disconnected", "interior-flooded", "zero-capacity"])("rejects a %s medical workplace", (fault) => {
  const s = town(); s.population.count = 0; s.fleet.doctors = 1;
  s.blocks[62] = BlockType.Hospital;
  s.buildings.push({ id: 5 as BuildingId, type: BlockType.Hospital, cells: [62], entrance: 62, capacity: 2, floorHeight: 1 });
  if (fault === "interior-flooded") s.buildings[1].floorHeight = 0.1;
  if (fault === "zero-capacity") s.buildings[1].capacity = 0;
  const { p, w, blocked, step } = setup(s); w.powered[14] = 1; w.powered[62] = 1;
  if (fault === "disconnected") for (const cell of [6, 13, 15, 22]) blocked[cell] = 1;
  if (fault === "interior-flooded") w.water[14] = 0.2;
  for (let t = 1; t <= 30; t++) step(t);
  expect(p.npcs.work[0]).toBe(62);
});
it("bounds distinct-target planning work and defers excess requests deterministically", () => {
  const s = town(); s.size = { w: 128, h: 128 }; s.ground = Array(16384).fill(0); s.blocks = Array(16384).fill(BlockType.Grass);
  s.blocks[0] = BlockType.House;
  s.buildings = [{ id: 1 as BuildingId, type: BlockType.House, cells: [0], entrance: 0, capacity: 40, floorHeight: 1 }];
  for (let cell = 1; cell <= 40; cell++) {
    s.blocks[cell] = BlockType.Office;
    s.buildings.push({ id: (cell + 1) as BuildingId, type: BlockType.Office, cells: [cell], entrance: cell, capacity: 1, floorHeight: 1 });
  }
  s.population.count = 40; s.population.customSchedule!.workTicks = 100;
  s.districts = [{ id: 1, name: "MOCK all", cells: Array.from({ length: 16384 }, (_, i) => i) }]; s.powerGrid = { nodes: [], edges: [] }; s.weather.sources = [];
  const { a, step } = setup(s); const all = [];
  for (let tick = 1; tick <= 30; tick++) {
    all.push(...step(tick));
    expect(a.planningStats.fields).toBeLessThanOrEqual(16);
    expect(a.planningStats.plans).toBeLessThanOrEqual(256);
    expect(a.planningStats.retainedBytes).toBeLessThanOrEqual(6 * 1024 * 1024);
  }
  expect(all.filter((event) => event.type === "ROUTE_PLANNED")).toHaveLength(40);
});
it("parks a car when an abandoned driving route cannot be replaced", () => {
  const s = town(1); s.buildings[2].cells = [23]; s.buildings[2].entrance = 23;
  s.blocks[18] = BlockType.Grass; s.blocks[23] = BlockType.Office;
  for (const cell of [10, 11, 12, 13, 21]) s.blocks[cell] = BlockType.Road;
  const { p, w, step } = setup(s);
  for (let t = 1; t <= 3; t++) step(t);
  w.water[23] = 0.6;
  for (let t = 4; t <= 60; t++) step(t);
  expect([NpcState.SeekHelp, NpcState.Stranded, NpcState.ShelterInPlace]).toContain(p.npcs.state[0]);
  expect(p.cars.state[0]).toBe(VehicleState.Idle);
  expect(p.npcs.role[0]).toBe(NpcRole.Civilian);
});
it("can complete a three-field car plan on the largest supported grid", () => {
  const s = town(1); s.buildings[2].cells = [23]; s.buildings[2].entrance = 23;
  s.blocks[18] = BlockType.Grass; s.blocks[23] = BlockType.Office;
  for (const cell of [10, 11, 12, 13, 21]) s.blocks[cell] = BlockType.Road;
  // Embed the 8x8 town in 128x128 without changing its topology.
  const map = (cell: number) => Math.floor(cell / 8) * 128 + cell % 8;
  const blocks = Array(16384).fill(BlockType.Tree); const ground = Array(16384).fill(0);
  for (let cell = 0; cell < 64; cell++) blocks[map(cell)] = s.blocks[cell];
  for (const b of s.buildings) { b.cells = b.cells.map(map); b.entrance = map(b.entrance); }
  s.size = { w: 128, h: 128 }; s.blocks = blocks; s.ground = ground;
  s.powerGrid = { nodes: [], edges: [] }; for (const b of s.buildings) delete b.powerNode;
  s.weather.sources = []; s.districts = [{ id: 1, name: "MOCK all", cells: Array.from({ length: 16384 }, (_, i) => i) }];
  const { p, step } = setup(s); let drove = false;
  for (let tick = 1; tick <= 60; tick++) { step(tick); drove ||= p.npcs.role[0] === NpcRole.Driver; }
  expect(drove).toBe(true); expect(p.npcs.state[0]).toBe(NpcState.AtHome);
});
it("bounds retained long routes as well as flow fields", () => {
  const s = town(); s.size = { w: 128, h: 128 }; s.ground = Array(16384).fill(0); s.blocks = Array(16384).fill(BlockType.Tree);
  for (let z = 0; z < 128; z++) {
    if (z % 2 === 0) for (let x = 0; x < 128; x++) s.blocks[z * 128 + x] = BlockType.Grass;
    else s.blocks[z * 128 + (Math.floor(z / 2) % 2 === 0 ? 127 : 0)] = BlockType.Grass;
  }
  s.blocks[0] = BlockType.House; s.blocks[16128] = BlockType.Office;
  s.buildings = [{ id: 1 as BuildingId, type: BlockType.House, cells: [0], entrance: 0, capacity: 40, floorHeight: 1 },
    { id: 2 as BuildingId, type: BlockType.Office, cells: [16128], entrance: 16128, capacity: 40, floorHeight: 1 }];
  s.population.count = 40; s.powerGrid = { nodes: [], edges: [] }; s.weather.sources = [];
  s.districts = [{ id: 1, name: "MOCK all", cells: Array.from({ length: 16384 }, (_, i) => i) }];
  const { a, step } = setup(s); step(1);
  expect(a.routeCells).toBeLessThanOrEqual(262144);
  expect(a.planningStats.deferred).toBeGreaterThan(0);
  expect(a.routes.size).toBeGreaterThan(0);
});
