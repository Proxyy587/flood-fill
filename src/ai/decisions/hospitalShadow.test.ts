import { expect, it } from 'vitest';
import { BlockType, type BuildingId } from '../../contracts/types';
import { livingFixture } from '../../sim/agents/living-fixture';
import { createHospitalSystem } from '../../sim/dispatch/hospitals';
import { createWorld } from '../../sim/world/grid';
import { makeHospitalShadowCase, compareHospitalShadow } from './hospitalShadow';

function setup() {
  const scenario = livingFixture();
  scenario.blocks[13] = BlockType.Road;
  scenario.blocks[21] = BlockType.Road;
  scenario.blocks[29] = BlockType.Road;
  scenario.blocks[34] = BlockType.Hospital;
  scenario.buildings.push({ id: 5 as BuildingId, type: BlockType.Hospital, cells: [34], entrance: 34, capacity: 10, floorHeight: 1 });
  const world = createWorld(scenario);
  world.powered[14] = 1;
  world.powered[34] = 1;
  const hospitals = createHospitalSystem(scenario, 2);
  const blocked = new Uint8Array(world.water.length);
  return { scenario, world, hospitals, blocked };
}

it('offers only feasible hospitals while preserving deterministic reservations', () => {
  const { scenario, world, hospitals, blocked } = setup();
  const shadow = makeHospitalShadowCase(hospitals, 20, 13, world, scenario, blocked);
  expect(shadow?.deterministicChoice).toBe('h2');
  expect(shadow?.candidates.map((candidate) => candidate.id)).toEqual(['h2', 'h5']);
  expect(Array.from(hospitals.reserved)).toEqual([0, 0]);
  world.powered[14] = 0;
  expect(makeHospitalShadowCase(hospitals, 20, 13, world, scenario, blocked)?.candidates.map((candidate) => candidate.id)).toEqual(['h5']);
});

it('rejects a model choice outside the feasible shortlist', () => {
  const { scenario, world, hospitals, blocked } = setup();
  const shadow = makeHospitalShadowCase(hospitals, 20, 13, world, scenario, blocked)!;
  expect(() => compareHospitalShadow(shadow, { choice: 'h99', probabilities: { h99: 1 }, durationMs: 2 })).toThrow(/candidate/i);
  expect(Array.from(hospitals.reserved)).toEqual([0, 0]);
});
