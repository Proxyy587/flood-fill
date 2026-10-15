import { ScenarioSchema } from "../../contracts/sim-schemas";
import type { Scenario } from "../../contracts/types";
import { BlockType } from "../../contracts/types";

/** Internal sim state; buildingId 0 means none, otherwise a branded numeric ID. */
export interface World {
  width: number; height: number; ground: Uint8Array; block: Uint8Array;
  buildingId: Int32Array; water: Float32Array; flow: Float32Array; powered: Uint8Array;
  barrier: Float32Array; scratch: Float64Array;
  bridgeDeck: Float32Array;
}
export function createWorld(input: Scenario): World {
  const scenario = ScenarioSchema.parse(input);
  const length = scenario.size.w * scenario.size.h;
  const buildingId = new Int32Array(length);
  const barrier = new Float32Array(length);
  const bridgeDeck = new Float32Array(length);
  for (let cell = 0; cell < length; cell++) if (scenario.blocks[cell] === BlockType.Bridge) bridgeDeck[cell] = scenario.ground[cell] + 1;
  for (const bridge of scenario.bridges ?? []) bridgeDeck[bridge.cell] = bridge.deckHeight;
  for (const building of scenario.buildings) for (const cell of building.cells) { buildingId[cell] = building.id; barrier[cell] = building.floorHeight; }
  return { width: scenario.size.w, height: scenario.size.h,
    ground: Uint8Array.from(scenario.ground), block: Uint8Array.from(scenario.blocks), buildingId,
    water: new Float32Array(length), flow: new Float32Array(length * 4), powered: new Uint8Array(length), barrier, scratch: new Float64Array(length), bridgeDeck };
}

/** Stable N,E,S,W order; boundary cells have fewer neighbours. */
export function neighbours(cell: number, width: number, height: number): number[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !Number.isInteger(cell) || cell < 0 || cell >= width * height) throw new RangeError("Invalid grid cell/dimensions");
  const result: number[] = []; const x = cell % width; const z = Math.floor(cell / width);
  if (z > 0) result.push(cell - width);
  if (x + 1 < width) result.push(cell + 1);
  if (z + 1 < height) result.push(cell + width);
  if (x > 0) result.push(cell - 1);
  return result;
}
