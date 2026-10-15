import { NpcState } from "../../contracts/types";
import type { PopulationState } from "../agents/population";
import type { World } from "../world/grid";

export type InjurySeverity = "minor" | "moderate" | "severe";
const exposureThreshold = Math.fround(0.3);

/** Synthetic exposure only; the caller marks patients loaded after field triage. */
export function stepExposure(population: PopulationState, world: World, loaded: Uint8Array): void {
  const civilians = population.civilianCount;
  if (loaded.length !== civilians) throw new RangeError("Loaded-patient flags must match the civilian table");
  for (let npc = 0; npc < civilians; npc++) {
    if (loaded[npc]) continue;
    const state = population.npcs.state[npc];
    if (state !== NpcState.SeekHelp && state !== NpcState.Stranded) continue;
    const depth = world.water[population.npcs.cell[npc]];
    if (depth <= exposureThreshold) continue;
    population.npcs.health[npc] = Math.max(0, population.npcs.health[npc] - (0.25 + 0.5 * (depth - 0.3)));
  }
}

/** Abstract simulation tier, not a clinical severity assessment. */
export function triageHealth(health: number): InjurySeverity {
  if (!Number.isFinite(health) || health < 0 || health > 100) throw new RangeError("Synthetic health must be finite and in [0,100]");
  if (health > 75) return "minor";
  if (health > 50) return "moderate";
  return "severe";
}
