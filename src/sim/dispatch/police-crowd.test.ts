import { expect, it } from "vitest";
import { BlockType, NpcState } from "../../contracts/types";
import type { AgentSystem } from "../agents/system";
import { livingFixture } from "../agents/living-fixture";
import { createAgentSystem, handoffRescuedCivilian } from "../agents/system";
import { createPopulation, type PopulationState } from "../agents/population";
import { buildHazardGrid } from "../nav/hazards";
import { findPath } from "../nav";
import { createWorld } from "../world/grid";
import { createCrowdControl, measureCrowdPressure, stepCrowdControl } from "./police-crowd";
import { PoliceTaskKind } from "./police";

function crowdFixture(count = 5) {
  const scenario = livingFixture();
  scenario.population.count = count;
  scenario.blocks[46] = BlockType.Grass;
  scenario.blocks[10] = BlockType.Shelter;
  const shelter = scenario.buildings.find((building) => building.type === BlockType.Shelter)!;
  shelter.cells = [10];
  shelter.entrance = 10;
  const world = createWorld(scenario);
  const population = createPopulation(scenario, 42);
  const agents = createAgentSystem(population, world, scenario);
  const crowd = createCrowdControl(world, scenario);
  return { scenario, world, population, agents, crowd };
}

function activateEvacuationRoute(agents: AgentSystem, population: PopulationState, npc: number, cells: number[], goal: number): void {
  const cursor = cells.indexOf(10);
  agents.intent[npc] = 3;
  agents.shelterAssignment[npc] = 0;
  population.npcs.state[npc] = NpcState.Evacuate;
  agents.routes.set(npc, { cells, modes: cells.map(() => 0), cursor, progress: 0, goal, version: npc + 1 });
  population.npcs.cell[npc] = cells[cursor - 1];
}

it("builds sorted bounded targets at shelter approaches and tight foot corridors", () => {
  const { scenario, world, crowd } = crowdFixture();
  const foot = buildHazardGrid(world, scenario, "foot");
  expect(crowd.targets).toBeInstanceOf(Int32Array);
  expect([...crowd.targets]).toEqual([...crowd.targets].sort((a, b) => a - b));
  expect(crowd.targetMask[10]).toBe(1);
  expect([...crowd.targets].some((cell) => Math.abs(cell % world.width - 10 % world.width) + Math.abs(Math.floor(cell / world.width) - Math.floor(10 / world.width)) === 1 && foot.passable[cell] === 1)).toBe(true);
  expect([...crowd.targets].every((cell) => foot.passable[cell] === 1)).toBe(true);
});

it("counts current and approaching civilians once at a target in one NPC pass", () => {
  const { scenario, world, population, agents } = crowdFixture(5);
  activateEvacuationRoute(agents, population, 0, [9, 10], 10);
  activateEvacuationRoute(agents, population, 1, [8, 9, 10], 10);
  population.npcs.cell[0] = 10;
  population.npcs.cell[1] = 8;
  const pressure = measureCrowdPressure(agents, world, scenario);
  expect(pressure.peopleAtOrApproaching).toBeInstanceOf(Uint32Array);
  expect(pressure.peopleAtOrApproaching[10]).toBe(2);
  expect(pressure.npcScans).toBe(population.civilianCount);
});

it("excludes non-civilians, inactive responders and civilians without an active safe route", () => {
  const { scenario, world, population, agents } = crowdFixture(3);
  activateEvacuationRoute(agents, population, 0, [9, 10], 10);
  activateEvacuationRoute(agents, population, 1, [9, 10], 10);
  activateEvacuationRoute(agents, population, 2, [9, 10], 10);
  population.npcs.cell[0] = 10;
  population.npcs.state[1] = NpcState.Respond;
  agents.routes.delete(2);
  const pressure = measureCrowdPressure(agents, world, scenario);
  expect(pressure.peopleAtOrApproaching[10]).toBe(1);
});

it("includes a valid map-edge corridor target", () => {
  const { scenario, world, crowd } = crowdFixture();
  expect(crowd.targetMask[0]).toBe(1);
  expect(crowd.targets[0]).toBe(0);
  expect(buildHazardGrid(world, scenario, "foot").passable[0]).toBe(1);
});

it("measures ten thousand civilians with one scan and no duplicate counts", () => {
  const { scenario, world, population, agents, crowd } = crowdFixture(10_000);
  for (let npc = 0; npc < population.civilianCount; npc++) {
    activateEvacuationRoute(agents, population, npc, [10, 11], 11);
    population.npcs.cell[npc] = 10;
  }
  const pressure = measureCrowdPressure(agents, world, scenario, crowd);
  expect(pressure.npcScans).toBe(10_000);
  expect(pressure.peopleAtOrApproaching[10]).toBe(10_000);
  expect([...crowd.targets].every((cell, index, cells) => index === 0 || cells[index - 1] < cell)).toBe(true);
});

it("ignores pressure on flooded or explicitly blocked foot cells", () => {
  const { scenario, world, population, agents } = crowdFixture(1);
  activateEvacuationRoute(agents, population, 0, [9, 10], 10);
  world.water[10] = 0.6;
  const pressure = measureCrowdPressure(agents, world, scenario);
  expect(pressure.peopleAtOrApproaching[10]).toBe(0);

  world.water[10] = 0;
  const topology = createCrowdControl(world, scenario);
  const blocked = new Uint8Array(world.width * world.height);
  blocked[10] = 1;
  const blockedPressure = measureCrowdPressure(agents, world, scenario, topology, blocked);
  expect(blockedPressure.peopleAtOrApproaching[10]).toBe(0);
});

it("rebuilds crowd target topology only when the navigation version changes", () => {
  const { scenario, world, population, agents, crowd } = crowdFixture(4);
  for (let npc = 0; npc < 4; npc++) {
    activateEvacuationRoute(agents, population, npc, [9, 10], 10);
    population.npcs.cell[npc] = 10;
  }
  stepCrowdControl(crowd, agents, world, scenario, undefined, 0, 1, Int32Array.from([11]));
  expect(crowd.targetMask[10]).toBe(1);
  world.block[10] = BlockType.Tree;
  scenario.blocks[10] = BlockType.Tree;
  stepCrowdControl(crowd, agents, world, scenario, undefined, 1, 2, Int32Array.from([11]));
  expect(crowd.targetMask[10]).toBe(0);
});

it("preserves active pressure state for targets that survive a topology rebuild", () => {
  const { scenario, world, population, agents, crowd } = crowdFixture(4);
  scenario.blocks[11] = BlockType.Road;
  world.block[11] = BlockType.Road;
  for (let npc = 0; npc < 4; npc++) {
    activateEvacuationRoute(agents, population, npc, [9, 10], 10);
    population.npcs.cell[npc] = 10;
  }
  const policeCells = Int32Array.from([11]);
  stepCrowdControl(crowd, agents, world, scenario, undefined, 0, 1, policeCells);
  expect(stepCrowdControl(crowd, agents, world, scenario, undefined, 0, 2, policeCells).candidates).toHaveLength(1);
  expect(crowd.active[10]).toBe(1);
  const rebuilt = stepCrowdControl(crowd, agents, world, scenario, undefined, 1, 3, policeCells);
  expect(crowd.active[10]).toBe(1);
  expect(rebuilt.candidates).toHaveLength(1);
});

it("counts safe boat-to-home handoffs but not ordinary return-home residents", () => {
  const { scenario, world, population, agents } = crowdFixture(2);
  expect(handoffRescuedCivilian(agents, 0, 10, world, scenario, new Uint8Array(64), false)).toBe(true);
  agents.routes.set(0, { cells: [10, 11], modes: [0, 0], cursor: 1, progress: 0, goal: 11, version: 1 });
  agents.intent[1] = 2;
  population.npcs.state[1] = NpcState.ReturnHome;
  agents.routes.set(1, { cells: [10, 11], modes: [0, 0], cursor: 1, progress: 0, goal: 11, version: 2 });
  population.npcs.cell[0] = 10;
  population.npcs.cell[1] = 10;
  expect(measureCrowdPressure(agents, world, scenario).peopleAtOrApproaching[10]).toBe(1);
});

it("replays crowd counters and candidates identically from fresh same-seed systems", () => {
  const replay = () => {
    const { scenario, world, population, agents, crowd } = crowdFixture(4);
    scenario.blocks[11] = BlockType.Road;
    world.block[11] = BlockType.Road;
    for (let npc = 0; npc < 4; npc++) {
      activateEvacuationRoute(agents, population, npc, [9, 10], 10);
      population.npcs.cell[npc] = 10;
    }
    const candidates = [1, 2, 3].map((tick) => stepCrowdControl(crowd, agents, world, scenario, undefined, 0, tick, Int32Array.from([11])).candidates);
    return { candidates, active: crowd.active.slice(), above: crowd.aboveTicks.slice(), below: crowd.belowTicks.slice() };
  };
  expect(replay()).toEqual(replay());
});

it("activates after two high-pressure ticks and clears only after five low-pressure ticks", () => {
  const { scenario, world, population, agents, crowd } = crowdFixture(4);
  const road = 11;
  scenario.blocks[road] = BlockType.Road;
  world.block[road] = BlockType.Road;
  for (let npc = 0; npc < 4; npc++) {
    activateEvacuationRoute(agents, population, npc, [9, 10], 10);
    population.npcs.cell[npc] = 10;
  }
  const policeCells = Int32Array.from([road]);
  expect(stepCrowdControl(crowd, agents, world, scenario, undefined, 0, 1, policeCells).candidates).toHaveLength(0);
  expect(stepCrowdControl(crowd, agents, world, scenario, undefined, 0, 2, policeCells).candidates).toHaveLength(1);
  for (let npc = 2; npc < 4; npc++) population.npcs.state[npc] = NpcState.AtHome;
  for (let tick = 3; tick <= 7; tick++) {
    const result = stepCrowdControl(crowd, agents, world, scenario, undefined, 0, tick, policeCells);
    expect(result.pressure.peopleAtOrApproaching[10]).toBe(2);
    expect(result.candidates).toHaveLength(1);
  }
  population.npcs.state[1] = NpcState.AtHome;
  for (let tick = 8; tick <= 11; tick++) expect(stepCrowdControl(crowd, agents, world, scenario, undefined, 0, tick, policeCells).candidates).toHaveLength(1);
  expect(stepCrowdControl(crowd, agents, world, scenario, undefined, 0, 12, policeCells).candidates).toHaveLength(0);
});

it("does not activate at three people, and requires both critical boundaries", () => {
  const three = crowdFixture(3);
  for (let npc = 0; npc < 3; npc++) {
    activateEvacuationRoute(three.agents, three.population, npc, [9, 10], 10);
    three.population.npcs.cell[npc] = 10;
  }
  const road = 11;
  three.scenario.blocks[road] = BlockType.Road;
  three.world.block[road] = BlockType.Road;
  const policeCells = Int32Array.from([road]);
  stepCrowdControl(three.crowd, three.agents, three.world, three.scenario, undefined, 0, 1, policeCells);
  expect(stepCrowdControl(three.crowd, three.agents, three.world, three.scenario, undefined, 0, 2, policeCells).candidates).toHaveLength(0);

  const eight = crowdFixture(8);
  for (let npc = 0; npc < 8; npc++) {
    activateEvacuationRoute(eight.agents, eight.population, npc, [9, 10], 10);
    eight.population.npcs.cell[npc] = 10;
  }
  eight.scenario.blocks[road] = BlockType.Road;
  eight.world.block[road] = BlockType.Road;
  eight.world.water[10] = 0.299;
  stepCrowdControl(eight.crowd, eight.agents, eight.world, eight.scenario, undefined, 0, 1, policeCells);
  expect(stepCrowdControl(eight.crowd, eight.agents, eight.world, eight.scenario, undefined, 0, 2, policeCells).candidates[0].critical).toBe(false);
  eight.population.npcs.state[7] = NpcState.AtHome;
  expect(stepCrowdControl(eight.crowd, eight.agents, eight.world, eight.scenario, undefined, 0, 3, policeCells).candidates[0].critical).toBe(false);
  eight.population.npcs.state[7] = NpcState.Evacuate;
  eight.agents.intent[7] = 3;
  eight.world.water[10] = 0.3;
  expect(stepCrowdControl(eight.crowd, eight.agents, eight.world, eight.scenario, undefined, 0, 4, policeCells).candidates[0].critical).toBe(true);
});

it("ranks higher pressure and flood threat deterministically and marks only exposed critical crowds", () => {
  const { scenario, world, population, agents, crowd } = crowdFixture(16);
  const road = 11;
  scenario.blocks[road] = BlockType.Road;
  world.block[road] = BlockType.Road;
  scenario.blocks[1] = BlockType.Road;
  world.block[1] = BlockType.Road;
  for (let npc = 0; npc < 16; npc++) {
    if (npc < 8) {
      activateEvacuationRoute(agents, population, npc, [9, 10], 10);
      population.npcs.cell[npc] = 10;
    } else {
      agents.intent[npc] = 3;
      population.npcs.state[npc] = NpcState.Evacuate;
      agents.routes.set(npc, { cells: [0, 1], modes: [0, 0], cursor: 0, progress: 0, goal: 1, version: npc + 1 });
      population.npcs.cell[npc] = 0;
    }
  }
  world.water[10] = 0.3;
  world.water[0] = 0.3;
  const policeCells = Int32Array.from([road, 1]);
  const candidates = stepCrowdControl(crowd, agents, world, scenario, undefined, 0, 1, policeCells).candidates;
  expect(candidates).toHaveLength(0);
  const second = stepCrowdControl(crowd, agents, world, scenario, undefined, 0, 2, policeCells).candidates;
  expect(second.map((candidate) => candidate.assignmentCell)).toEqual([0, 10]);
  expect(second[0]).toMatchObject({ critical: true, urgency: 800_300 });
  expect(second[1]).toMatchObject({ critical: true, urgency: 800_300 });
  expect(stepCrowdControl(crowd, agents, world, scenario, undefined, 0, 3, policeCells).candidates).toEqual(second);
});

it("does not dispatch from a remote police origin with no safe route", () => {
  const { scenario, world, population, agents, crowd } = crowdFixture(4);
  for (let npc = 0; npc < 4; npc++) {
    activateEvacuationRoute(agents, population, npc, [9, 10], 10);
    population.npcs.cell[npc] = 10;
  }
  scenario.blocks[11] = BlockType.Road;
  world.block[11] = BlockType.Road;
  scenario.blocks[17] = BlockType.Road;
  world.block[17] = BlockType.Road;
  const blocked = new Uint8Array(64);
  stepCrowdControl(crowd, agents, world, scenario, blocked, 0, 1, Int32Array.from([17]));
  const second = stepCrowdControl(crowd, agents, world, scenario, blocked, 0, 2, Int32Array.from([17]));
  expect(second.pressure.peopleAtOrApproaching[10]).toBe(4);
  expect(second.candidates).toEqual([]);
});

it("chooses the nearest reachable safe police rendezvous cell", () => {
  const { scenario, world, population, agents, crowd } = crowdFixture(4);
  for (let npc = 0; npc < 4; npc++) {
    activateEvacuationRoute(agents, population, npc, [9, 10], 10);
    population.npcs.cell[npc] = 10;
  }
  for (const cell of [9, 11, 19, 25, 26, 27]) {
    scenario.blocks[cell] = BlockType.Road;
    world.block[cell] = BlockType.Road;
  }
  world.buildingId[9] = 0;
  const carGrid = buildHazardGrid(world, scenario, "car");
  expect(findPath(carGrid, 17, 9)).toHaveLength(2);
  expect(findPath(carGrid, 17, 11)!.length).toBeGreaterThan(2);
  stepCrowdControl(crowd, agents, world, scenario, undefined, 0, 1, Int32Array.from([17]));
  const candidate = stepCrowdControl(crowd, agents, world, scenario, undefined, 0, 2, Int32Array.from([17])).candidates[0];
  expect(candidate.targetCell).toBe(9);
});

it("selects a safe car-passable roadside rendezvous and omits targets without one", () => {
  const { scenario, world, population, agents, crowd } = crowdFixture(4);
  for (let npc = 0; npc < 4; npc++) {
    activateEvacuationRoute(agents, population, npc, [9, 10], 10);
    population.npcs.cell[npc] = 10;
  }
  const road = 11;
  scenario.blocks[road] = BlockType.Road;
  world.block[road] = BlockType.Road;
  const blocked = new Uint8Array(world.width * world.height);
  blocked[road] = 1;
  const policeCells = Int32Array.from([road]);
  stepCrowdControl(crowd, agents, world, scenario, blocked, 0, 1, policeCells);
  expect(stepCrowdControl(crowd, agents, world, scenario, blocked, 0, 2, policeCells).candidates).toHaveLength(0);
  blocked[road] = 0;
  stepCrowdControl(crowd, agents, world, scenario, blocked, 0, 3, policeCells);
  const candidate = stepCrowdControl(crowd, agents, world, scenario, blocked, 0, 4, policeCells).candidates[0];
  expect(candidate).toMatchObject({ assignmentCell: 10, targetCell: road, kind: PoliceTaskKind.CrowdControl });
});
