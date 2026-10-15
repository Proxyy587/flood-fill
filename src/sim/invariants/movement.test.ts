import { expect, it } from "vitest";
import { BlockType } from "../../contracts/types";
import { mockScenario } from "../../contracts/mocks/ak";
import { createWorld } from "../world/grid";
import { assertMovementEntry } from "./movement";

it("rejects jumps, row wrapping, excessive water and explicit closures", () => {
  const s = mockScenario(); const w = createWorld(s); const blocked = new Uint8Array(64);
  expect(() => assertMovementEntry(w, 24, 26, "car", blocked)).toThrow(/adjacent/);
  expect(() => assertMovementEntry(w, 31, 32, "foot", blocked)).toThrow(/adjacent/);
  expect(() => assertMovementEntry(w, 24, 25, "car", blocked)).not.toThrow();
  w.water[25] = 0.31; expect(() => assertMovementEntry(w, 24, 25, "car", blocked)).toThrow(/depth/);
  expect(() => assertMovementEntry(w, 24, 25, "foot", blocked)).not.toThrow();
  w.water[25] = 0.51; expect(() => assertMovementEntry(w, 24, 25, "foot", blocked)).toThrow(/depth/);
  w.water[25] = 0; blocked[25] = 1; expect(() => assertMovementEntry(w, 24, 25, "car", blocked)).toThrow(/closed/);
});
it("uses bridge deck overtopping and forbids off-road car entry", () => {
  const s = mockScenario(); s.blocks[25] = BlockType.Bridge;
  const w = createWorld(s); const blocked = new Uint8Array(64);
  w.water[25] = 0.9; expect(() => assertMovementEntry(w, 24, 25, "car", blocked)).not.toThrow();
  w.water[25] = 1; expect(() => assertMovementEntry(w, 24, 25, "car", blocked)).toThrow(/deck/);
  expect(() => assertMovementEntry(w, 24, 16, "car", blocked)).toThrow(/road/);
});
