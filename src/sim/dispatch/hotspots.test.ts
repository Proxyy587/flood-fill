import { expect, it } from "vitest";
import { BlockType, VehicleState } from "../../contracts/types";
import type { BuildingId } from "../../contracts/types";
import { createAmbulances, stepAmbulances } from "./ambulances";
import { createHospitalSystem } from "./hospitals";
import { createWorld } from "../world/grid";
import { createHotspotSystem, hotspotZoneForCell, stageIdleAmbulances, updateHotspots } from "./hotspots";
import { mockScenario } from "../../contracts/mocks/ak";

it("maps edge cells into fixed 8x8 zones and scores uncovered severe demand plus recent admissions", () => {
  const hotspots = createHotspotSystem(17, 9);
  expect([hotspotZoneForCell(hotspots, 0), hotspotZoneForCell(hotspots, 7), hotspotZoneForCell(hotspots, 8),
    hotspotZoneForCell(hotspots, 16), hotspotZoneForCell(hotspots, 16 + 8 * 17)]).toEqual([0, 0, 1, 2, 5]);
  updateHotspots(hotspots,
    [{ cell: 0, severe: true, uncovered: true }, { cell: 1, severe: true, uncovered: true }, { cell: 2, severe: false, uncovered: true }],
    [{ cell: 7, severe: true }, { cell: 16 + 8 * 17, severe: false }], 0);
  expect(Array.from(hotspots.score)).toEqual([5, 0, 0, 0, 0, 0]);
  updateHotspots(hotspots, [], [], 120);
  expect(hotspots.score.every((score) => score === 0)).toBe(true);
});

function stagingCity() {
  const scenario = mockScenario();
  scenario.size = { w: 16, h: 8 };
  scenario.ground = Array<number>(128).fill(0);
  scenario.blocks = Array<number>(128).fill(BlockType.Grass);
  for (let cell = 16; cell < 32; cell++) scenario.blocks[cell] = BlockType.Road;
  for (const building of scenario.buildings) for (const cell of building.cells) scenario.blocks[cell] = building.type;
  scenario.buildings.push({ id: 5 as BuildingId, type: BlockType.Hospital, cells: [5], entrance: 5, capacity: 10, floorHeight: 1 });
  scenario.blocks[5] = BlockType.Hospital;
  scenario.fleet.ambulances = 2;
  const world = createWorld(scenario);
  world.powered[14] = 1;
  world.powered[5] = 1;
  const blocked = new Uint8Array(world.water.length);
  const ambulances = createAmbulances(scenario, world, blocked);
  const hospitals = createHospitalSystem(scenario, 0);
  const hotspots = createHotspotSystem(scenario.size.w, scenario.size.h);
  updateHotspots(hotspots, [{ cell: 0, severe: true, uncovered: true }], [], 0);
  return { scenario, world, blocked, ambulances, hospitals, hotspots };
}

it("stages only idle unassigned ambulances toward the operational hospital nearest the hot zone", () => {
  const { scenario, world, blocked, ambulances, hospitals, hotspots } = stagingCity();
  ambulances.assignment[1] = 12;
  ambulances.state[1] = VehicleState.Moving;

  stageIdleAmbulances(hotspots, ambulances, hospitals, world, scenario, blocked, 0);
  expect(ambulances.target[0]).toBe(21);
  expect(ambulances.routes[0]).not.toBeNull();
  expect(ambulances.assignment[1]).toBe(12);
  expect(ambulances.target[1]).toBe(-1);
  stepAmbulances(ambulances, world, scenario, blocked, 0);
  expect(ambulances.cell[0]).toBe(29);
});

it("leaves idle units at their current operational hospital when there is no severe demand", () => {
  const { scenario, world, blocked, ambulances, hospitals } = stagingCity();
  const hotspots = createHotspotSystem(scenario.size.w, scenario.size.h);
  stageIdleAmbulances(hotspots, ambulances, hospitals, world, scenario, blocked, 0);

  expect(ambulances.state.every((state) => state === VehicleState.Idle)).toBe(true);
  expect(ambulances.routes.every((route) => route === null)).toBe(true);
});
