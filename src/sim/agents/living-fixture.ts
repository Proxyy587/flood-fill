import { BlockType } from "../../contracts/types";
import type { BuildingId, Scenario } from "../../contracts/types";
import { mockScenario } from "../../contracts/mocks/ak";

/** Small synthetic demo/test town; W1 owns real scenario templates. */
export function livingFixture(): Scenario {
  const s = mockScenario(); s.name = "MOCK living town";
  s.blocks[18] = BlockType.Office; s.blocks[46] = BlockType.Shelter;
  s.blocks[17] = BlockType.Road; s.blocks[22] = BlockType.Road; s.blocks[38] = BlockType.Road;
  s.buildings.push(
    { id: 3 as BuildingId, type: BlockType.Office, cells: [18], entrance: 18, capacity: 6, floorHeight: 1 },
    { id: 4 as BuildingId, type: BlockType.Shelter, cells: [46], entrance: 46, capacity: 12, floorHeight: 1 },
  );
  return s;
}
