import { expect, it } from "vitest";
import { BlockType, NpcState } from "../../contracts/types";
import { livingFixture } from "../agents/living-fixture";
import { createAgentSystem, handoffRescuedCivilian, type AgentSystem } from "../agents/system";
import { createPopulation } from "../agents/population";
import { createWorld } from "../world/grid";
import { createTraffic } from "../traffic";
import { createPolice, PoliceTaskKind, stepPolice } from "./police";
import { createEscortSystem, escortCandidates, escortWaypoint, stepEscortGroups } from "./police-escort";

function escortFixture(count = 2) {
  const scenario = livingFixture();
  scenario.population.count = count;
  scenario.fleet.ambulances = 0;
  scenario.fleet.policeCars = 1;
  scenario.fleet.policeOfficers = 1;
  scenario.blocks[18] = BlockType.PoliceStation;
  scenario.buildings.find((building) => building.id === 3)!.type = BlockType.PoliceStation;
  for (const cell of [17, 19, 25, 26, 35]) scenario.blocks[cell] = BlockType.Road;
  const world = createWorld(scenario);
  const population = createPopulation(scenario, 42);
  const agents = createAgentSystem(population, world, scenario);
  const escort = createEscortSystem(population.civilianCount);
  const blocked = new Uint8Array(world.width * world.height);
  const police = createPolice(scenario, world, blocked);
  const traffic = createTraffic(world);
  return { scenario, world, population, agents, escort, blocked, police, traffic };
}

function activateEvacuationRoute(agents: AgentSystem, npc: number, cells: number[], goal: number) {
  agents.intent[npc] = 3;
  agents.shelterAssignment[npc] = 0;
  agents.population.npcs.state[npc] = NpcState.Evacuate;
  const cursor = cells.indexOf(10);
  agents.routes.set(npc, { cells, modes: cells.map(() => 0), cursor, progress: 0, goal, version: npc + 1 });
  agents.population.npcs.cell[npc] = cells[cursor - 1];
}

it("groups only evacuating civilians with the same destination and next route segment", () => {
  const { agents, escort } = escortFixture(3);
  activateEvacuationRoute(agents, 0, [9, 10, 11, 19, 27, 35, 43, 44, 45, 46], 46);
  activateEvacuationRoute(agents, 1, [8, 9, 10, 11, 19, 27, 35, 43, 44, 45, 46], 46);
  activateEvacuationRoute(agents, 2, [8, 9, 10, 11, 19, 27, 35, 43, 44, 45, 46, 47], 47);
  expect(stepEscortGroups(escort, agents, 0).map((group) => group.members)).toContainEqual([0, 1]);
  expect(stepEscortGroups(escort, agents, 0).map((group) => group.members)).toContainEqual([2]);
});

it("chooses the lowest-index reachable road beside the civilian route", () => {
  const fixture = escortFixture(1);
  activateEvacuationRoute(fixture.agents, 0, [9, 10, 11, 19, 27, 35, 43, 44, 45, 46], 46);
  fixture.scenario.blocks[19] = BlockType.Road;
  fixture.world.block[19] = BlockType.Road;
  fixture.world.water[19] = 0.31;
  const [group] = stepEscortGroups(fixture.escort, fixture.agents, 0);
  expect(escortWaypoint(group, fixture.world, fixture.scenario, fixture.blocked, fixture.police.cell[0])).toBe(17);
});

it("withholds behavioral guidance until the police car reaches the roadside waypoint", () => {
  const fixture = escortFixture(1);
  activateEvacuationRoute(fixture.agents, 0, [9, 10, 11, 19, 27, 35, 43, 44, 45, 46], 46);
  const [group] = stepEscortGroups(fixture.escort, fixture.agents, 1);
  const tasks = escortCandidates([group], fixture.agents, fixture.world, fixture.scenario, fixture.blocked, fixture.police.cell);
  tasks[0].targetCell = 35;
  const first = stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 1, tasks);
  expect(first.escortGuidance.size).toBe(0);
  let arrived = false;
  for (let tick = 2; tick <= 10; tick++) {
    const result = stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, tick, tasks);
    if (result.escortGuidance.has(0)) {
      arrived = result.events.some((event) => event.type === "ARRIVED" && event.targetKind === "npc");
      break;
    }
  }
  expect(arrived).toBe(true);
});

it("does not dispatch an escort over a newly unsafe civilian route", () => {
  const fixture = escortFixture(1);
  activateEvacuationRoute(fixture.agents, 0, [9, 10, 11, 19, 27, 35, 43, 44, 45, 46], 46);
  fixture.world.water[19] = 0.6;
  const groups = stepEscortGroups(fixture.escort, fixture.agents, 1);
  expect(escortCandidates(groups, fixture.agents, fixture.world, fixture.scenario, fixture.blocked, fixture.police.cell)).toEqual([]);
});

it("does not dispatch an escort when the civilian's current tile has become unsafe", () => {
  const fixture = escortFixture(1);
  activateEvacuationRoute(fixture.agents, 0, [9, 10, 11, 19, 27, 35, 43, 44, 45, 46], 46);
  fixture.world.water[9] = 0.6;
  const groups = stepEscortGroups(fixture.escort, fixture.agents, 1);
  expect(escortCandidates(groups, fixture.agents, fixture.world, fixture.scenario, fixture.blocked, fixture.police.cell)).toEqual([]);
});

it("assigns only a police car and leaves civilian route and shelter ownership unchanged", () => {
  const fixture = escortFixture(1);
  activateEvacuationRoute(fixture.agents, 0, [9, 10, 11, 19, 27, 35, 43, 44, 45, 46], 46);
  const original = structuredClone(fixture.agents.routes.get(0));
  const reservation = fixture.agents.shelterAssignment[0];
  const groups = stepEscortGroups(fixture.escort, fixture.agents, 1);
  const tasks = escortCandidates(groups, fixture.agents, fixture.world, fixture.scenario, fixture.blocked, fixture.police.cell);
  const result = stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 1, tasks);

  expect(fixture.police.taskKind[0]).toBe(PoliceTaskKind.Escort);
  expect(result.events).toContainEqual(expect.objectContaining({ type: "ASSIGNED", actorKind: "vehicle", targetKind: "npc" }));
  expect(result.controlled.every((value) => value === 0)).toBe(true);
  expect(fixture.agents.routes.get(0)).toEqual(original);
  expect(fixture.agents.shelterAssignment[0]).toBe(reservation);
  expect(fixture.population.npcs.state[0]).toBe(NpcState.Evacuate);
});

it("recognizes only explicitly marked safe boat-to-home handoffs", () => {
  const fixture = escortFixture(1);
  expect(handoffRescuedCivilian(fixture.agents, 0, 24, fixture.world, fixture.scenario, fixture.blocked, false)).toBe(true);
  const goal = fixture.population.npcs.home[0];
  fixture.agents.routes.set(0, { cells: [23, 24, 25, goal], modes: [0, 0, 0, 0], cursor: 1, progress: 0, goal, version: 1 });
  expect(stepEscortGroups(fixture.escort, fixture.agents, 1).map((group) => group.members)).toEqual([[0]]);
  fixture.agents.rescueHandoff[0] = 0;
  expect(stepEscortGroups(fixture.escort, fixture.agents, 2)).toEqual([]);
});
