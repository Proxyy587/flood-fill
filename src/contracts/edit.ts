import type { BlockType } from './blocks';
import type { BuildingDef } from './scenario';

export type EditCommand =
  | { kind: 'setBlock'; cell: number; block: BlockType; variant?: number }
  | { kind: 'paintRect'; x0: number; z0: number; x1: number; z1: number; block: BlockType }
  | { kind: 'setHeight'; cell: number; ground: number }
  | { kind: 'placeBuilding'; def: Omit<BuildingDef, 'id'> }
  | { kind: 'removeAt'; cell: number }
  | { kind: 'setPowerEdge'; a: number; b: number; on: boolean }
  /** From the AI critic. */
  | { kind: 'applyPatch'; patch: ScenarioPatch };

export interface ScenarioPatch {
  title: string;
  rationale: string;
  commands: EditCommand[];
  /** Abstract units. */
  estimatedCost: number;
}
