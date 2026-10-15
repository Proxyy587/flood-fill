import { BlockType } from "../../contracts/types";
import type { World } from "../world/grid";

/** Independent entry assertion; intentionally does not reuse the route planner. */
export function assertMovementEntry(world: World, from: number, to: number, mode: "foot" | "car", blocked: Uint8Array): void {
  const count = world.width * world.height;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= count || to >= count ||
      Math.abs(from % world.width - to % world.width) + Math.abs(Math.floor(from / world.width) - Math.floor(to / world.width)) !== 1) throw new Error("Movement must enter an adjacent cell");
  if (blocked[to]) throw new Error("Movement entered an explicitly closed cell");
  const depth = world.water[to];
  if (!Number.isFinite(depth) || depth < 0) throw new Error("Invalid movement depth");
  if (world.block[to] === BlockType.Bridge) {
    const deck = world.bridgeDeck[to];
    if (!Number.isFinite(deck) || deck <= world.ground[to] || world.ground[to] + depth >= deck) throw new Error("Movement entered an overtopped bridge deck");
  } else if (depth > Math.fround(mode === "car" ? 0.3 : 0.5)) throw new Error("Movement exceeds operating depth");
  if (mode === "car" && world.block[to] !== BlockType.Road && world.block[to] !== BlockType.Bridge) throw new Error("Car entered a non-road cell");
}
