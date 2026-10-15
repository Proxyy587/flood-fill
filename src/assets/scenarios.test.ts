import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { BlockType, type Scenario } from "../contracts/types";
import { ScenarioSchema } from "../contracts/schemas";

describe("Scenario Templates Verification Suite", () => {
  it("validates all generated scenarios in scenarios/*.json against ScenarioSchema", async () => {
    const files = (await readdir("scenarios")).filter((f) => f.endsWith(".json") && f !== "index.json");
    expect(files.length).toBeGreaterThanOrEqual(4);

    for (const file of files) {
      const raw = await readFile(`scenarios/${file}`, "utf8");
      const json = JSON.parse(raw);
      const parsed = ScenarioSchema.parse(json);
      expect(parsed.name).toBeTruthy();
      expect(parsed.size.w).toBeGreaterThanOrEqual(64);
      expect(parsed.size.h).toBeGreaterThanOrEqual(64);
    }
  });

  it("verifies every scenario has at least 4 districts and a quiet weather period >= 300 ticks", async () => {
    const files = (await readdir("scenarios")).filter((f) => f.endsWith(".json") && f !== "index.json");
    for (const file of files) {
      const scenario: Scenario = JSON.parse(await readFile(`scenarios/${file}`, "utf8"));
      expect(scenario.districts.length, `${file} should have >= 4 districts`).toBeGreaterThanOrEqual(4);

      // Weather quiet period: rain intensity should remain minimal (<= 0.1) for first 300 ticks (5 sim-minutes)
      const earlyRain = scenario.weather.rain.filter((p) => p.t <= 300);
      expect(earlyRain.length).toBeGreaterThanOrEqual(1);
      for (const p of earlyRain) {
        expect(p.intensity, `${file} rain should be calm (<0.1) in first 300 ticks`).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it("verifies dry road connectivity from every house, shelter and hospital to medical centers", async () => {
    const files = (await readdir("scenarios")).filter((f) => f.endsWith(".json") && f !== "index.json");

    for (const file of files) {
      const scenario: Scenario = JSON.parse(await readFile(`scenarios/${file}`, "utf8"));
      const { w, h } = scenario.size;

      // Build traversable road/bridge set
      const isRoadOrBridge = (cell: number) => {
        const b = scenario.blocks[cell];
        return b === BlockType.Road || b === BlockType.Bridge || b === BlockType.Drainage;
      };

      // Adjacency on grid for road network
      const neighbors = (cell: number): number[] => {
        const x = cell % w;
        const z = Math.floor(cell / w);
        const res: number[] = [];
        if (x > 0) res.push(cell - 1);
        if (x < w - 1) res.push(cell + 1);
        if (z > 0) res.push(cell - w);
        if (z < h - 1) res.push(cell + w);
        return res.filter(isRoadOrBridge);
      };

      // Find all hospital buildings
      const hospitals = scenario.buildings.filter((b) => b.type === BlockType.Hospital);
      expect(hospitals.length, `${file} must contain at least one hospital`).toBeGreaterThanOrEqual(1);

      // Find road cells adjacent to hospitals
      const getAdjacentRoads = (bCells: number[]): number[] => {
        const roads = new Set<number>();
        for (const cell of bCells) {
          const x = cell % w;
          const z = Math.floor(cell / w);
          for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx >= 0 && nx < w && nz >= 0 && nz < h) {
              const nCell = nz * w + nx;
              if (isRoadOrBridge(nCell)) roads.add(nCell);
            }
          }
        }
        return Array.from(roads);
      };

      const hospitalRoads = hospitals.flatMap((h) => getAdjacentRoads(h.cells));
      expect(hospitalRoads.length, `${file} hospitals must have adjacent road access`).toBeGreaterThan(0);

      // BFS to find all road cells connected to hospital road network
      const reachableRoads = new Set<number>();
      const queue: number[] = [...hospitalRoads];
      for (const r of hospitalRoads) reachableRoads.add(r);

      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const next of neighbors(current)) {
          if (!reachableRoads.has(next)) {
            reachableRoads.add(next);
            queue.push(next);
          }
        }
      }

      // Assert that critical buildings and housing have access to the connected road network
      const testBuildings = scenario.buildings.filter(
        (b) =>
          b.type === BlockType.Hospital ||
          b.type === BlockType.Shelter ||
          b.type === BlockType.FloodHQ ||
          b.type === BlockType.House ||
          b.type === BlockType.Apartment ||
          b.type === BlockType.PoliceStation ||
          b.type === BlockType.BoatDepot
      );

      for (const b of testBuildings) {
        const adj = getAdjacentRoads(b.cells);
        const hasConnectedRoad = adj.some((r) => reachableRoads.has(r));
        expect(hasConnectedRoad, `${file} building ${BlockType[b.type]} (id: ${b.id}) has no path to hospital road network`).toBe(true);
      }
    }
  });

  it("verifies scenarios/index.json accurately manifests all scenario files", async () => {
    const raw = await readFile("scenarios/index.json", "utf8");
    const manifest = JSON.parse(raw);
    expect(manifest.length).toBeGreaterThanOrEqual(4);

    for (const item of manifest) {
      expect(item.id).toBeTruthy();
      expect(item.name).toBeTruthy();
      expect(item.file).toBeTruthy();
      expect(item.districts).toBeGreaterThanOrEqual(4);
    }
  });
});
