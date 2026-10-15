import { expect, it } from "vitest";
import { mockScenario } from "../../contracts/mocks";
import { createWorld, neighbours } from "./grid";
import { BlockType } from "../../contracts";

it("stores explicit bridge decks with a one-metre legacy fallback", () => {
  const s = mockScenario(); s.blocks[24] = BlockType.Bridge; s.blocks[25] = BlockType.Bridge;
  s.bridges = [{ cell: 24, deckHeight: 2 }];
  const w = createWorld(s);
  expect(w.bridgeDeck[24]).toBe(2); expect(w.bridgeDeck[25]).toBe(1);
});

it("creates independent typed arrays without mutating scenario input", () => {
  const s = mockScenario(); const a = createWorld(s); const b = createWorld(s);
  expect(a.ground).toBeInstanceOf(Uint8Array);
  a.ground[0] = 7; a.water[0] = 3;
  expect(s.ground[0]).toBe(0); expect(b.water[0]).toBe(0);
  expect(a.buildingId[9]).toBe(1);
});
it("lists cardinal neighbours without row wrapping", () => {
  expect(neighbours(7, 8, 8)).toEqual([15, 6]);
  expect(neighbours(0, 8, 8)).toEqual([1, 8]);
  expect(() => neighbours(64, 8, 8)).toThrow(RangeError);
});
it("rejects malformed scenarios", () => {
  const s = mockScenario(); s.blocks = [];
  expect(() => createWorld(s)).toThrow();
});
