import { BlockType, NpcState } from "../../contracts/types";
import type { Scenario } from "../../contracts/types";
import type { AgentSystem, AgentRoute } from "../agents/system";
import { buildHazardGrid, canEnter } from "../nav/hazards";
import { findPath } from "../nav";
import { neighbours, type World } from "../world/grid";
import { PoliceTaskKind, type PoliceTaskCandidate } from "./police";

export interface EscortGroup { subject: number; members: number[]; goal: number; currentCell: number; nextCell: number; eligibleSince: number }
export interface EscortSystem { eligibleSince: Int32Array; width: number }

export function createEscortSystem(civilianCount: number, width = 8): EscortSystem {
  return { eligibleSince: new Int32Array(civilianCount).fill(-1), width };
}

function eligibleRoute(agents: AgentSystem, npc: number): AgentRoute | undefined {
  const state = agents.population.npcs.state[npc];
  const evacuee = agents.intent[npc] === 3 && state === NpcState.Evacuate;
  const homeHandoff = agents.rescueHandoff[npc] === 1 && state === NpcState.ReturnHome;
  if (!evacuee && !homeHandoff) return undefined;
  const route = agents.routes.get(npc);
  if (!route || route.goal < 0 || route.cursor < 1 || route.cursor >= route.cells.length || route.modes[route.cursor] !== 0) return undefined;
  return route;
}

export function stepEscortGroups(system: EscortSystem, agents: AgentSystem, tick: number): EscortGroup[] {
  const groups = new Map<string, number[]>();
  for (let npc = 0; npc < agents.population.civilianCount; npc++) {
    const route = eligibleRoute(agents, npc);
    if (!route) { system.eligibleSince[npc] = -1; continue; }
    const key = `${route.goal}:${route.cells[route.cursor]}`;
    const members = groups.get(key) ?? [];
    members.push(npc);
    groups.set(key, members);
    if (system.eligibleSince[npc] < 0) system.eligibleSince[npc] = tick;
  }
  const result: EscortGroup[] = [];
  for (const [key, candidates] of groups) {
    candidates.sort((a, b) => a - b);
    const leader = candidates[0];
    const leaderCell = agents.population.npcs.cell[leader];
    const members = candidates.filter((npc) => {
      const cell = agents.population.npcs.cell[npc];
      return Math.abs(cell % system.width - leaderCell % system.width) + Math.abs(Math.floor(cell / system.width) - Math.floor(leaderCell / system.width)) <= 2;
    });
    if (members.length === 0) continue;
    const [goal, nextCell] = key.split(":").map(Number);
    const leaderRoute = eligibleRoute(agents, leader)!;
    result.push({ subject: leader, members, goal, currentCell: leaderRoute.cells[leaderRoute.cursor - 1], nextCell, eligibleSince: Math.min(...members.map((npc) => system.eligibleSince[npc])) });
  }
  result.sort((a, b) => a.eligibleSince - b.eligibleSince || a.subject - b.subject);
  return result;
}

export function escortWaypoint(group: EscortGroup, world: World, scenario: Scenario, blocked: Uint8Array, policeCell: number): number | null {
  const grid = buildHazardGrid(world, scenario, "car", blocked);
  const adjacentRoads = [...new Set([...neighbours(group.currentCell, world.width, world.height), ...neighbours(group.nextCell, world.width, world.height)])]
    .filter((cell) => (world.block[cell] === BlockType.Road || world.block[cell] === BlockType.Bridge) && canEnter(world, scenario, "car", cell, blocked))
    .sort((a, b) => a - b);
  let best: number | null = null;
  let bestLength = Infinity;
  for (const cell of adjacentRoads) {
    const path = findPath(grid, policeCell, cell);
    if (path && (path.length < bestLength || path.length === bestLength && (best === null || cell < best))) {
      best = cell;
      bestLength = path.length;
    }
  }
  return best;
}

export function escortCandidates(groups: readonly EscortGroup[], agents: AgentSystem, world: World, scenario: Scenario, blocked: Uint8Array, policeCells: Int32Array): PoliceTaskCandidate[] {
  const candidates: PoliceTaskCandidate[] = [];
  for (const group of groups) {
    const nearestCell = agents.population.npcs.cell[group.subject];
    let selected: number | null = null;
    let bestDistance = Infinity;
    for (const cell of policeCells) {
      if (cell < 0) continue;
      const distance = Math.abs(cell % world.width - nearestCell % world.width) + Math.abs(Math.floor(cell / world.width) - Math.floor(nearestCell / world.width));
      if (distance < bestDistance) { selected = cell; bestDistance = distance; }
    }
    if (selected === null) continue;
    const targetCell = escortWaypoint(group, world, scenario, blocked, selected);
    if (targetCell === null) continue;
    const npc = agents.population.npcs;
    const highNeed = group.members.some((member) => npc.mobility[member] > 0);
    const nearbyWater = world.water[group.nextCell];
    candidates.push({ kind: PoliceTaskKind.Escort, subject: group.subject, civilianId: npc.id[group.subject], assignmentCell: group.nextCell, targetCell,
      urgency: (highNeed ? 1000 : 0) + Math.round(nearbyWater * 100), critical: false, eligibleSince: group.eligibleSince });
  }
  return candidates.sort((a, b) => b.urgency - a.urgency || a.eligibleSince - b.eligibleSince || a.subject - b.subject);
}
