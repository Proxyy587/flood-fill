import { describe, expect, it } from "vitest";
import { MODELS, getModel, previewModel } from "./index";

describe("Voxel Models Suite", () => {
  const modelEntries = Object.entries(MODELS);

  it("contains all required building, vehicle and person models", () => {
    const required = [
      "house_v1", "house_v2", "apartment", "office", "shop", "hospital",
      "police_station", "flood_hq", "boat_depot", "shelter", "helipad",
      "substation", "power_plant", "drainage", "tree_v1", "tree_v2", "levee",
      "car_red", "car_blue", "car_yellow", "bus", "ambulance", "police_car",
      "boat", "helicopter", "helicopter_rotor",
      "person_civilian", "person_police", "person_boat_operator", "person_paramedic",
      "person_doctor", "person_nurse", "person_pilot",
    ];

    for (const name of required) {
      expect(MODELS[name], `Expected model ${name} to exist`).toBeDefined();
    }
  });

  it("verifies every model fits within declared size and has no duplicate voxels", () => {
    for (const [name, model] of modelEntries) {
      const [w, h, d] = model.size;
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      expect(d).toBeGreaterThan(0);

      // Model voxel count reasonable for real-time voxel rendering
      expect(model.voxels.length, `${name} has too many voxels (${model.voxels.length})`).toBeLessThanOrEqual(250);
      expect(model.voxels.length, `${name} has no voxels`).toBeGreaterThan(0);

      const seenCoords = new Set<string>();
      for (const v of model.voxels) {
        // Coordinate bounds
        expect(v.x, `${name} voxel x (${v.x}) out of bounds [0, ${w})`).toBeGreaterThanOrEqual(0);
        expect(v.x, `${name} voxel x (${v.x}) out of bounds [0, ${w})`).toBeLessThan(w);

        expect(v.y, `${name} voxel y (${v.y}) out of bounds [0, ${h})`).toBeGreaterThanOrEqual(0);
        expect(v.y, `${name} voxel y (${v.y}) out of bounds [0, ${h})`).toBeLessThan(h);

        expect(v.z, `${name} voxel z (${v.z}) out of bounds [0, ${d})`).toBeGreaterThanOrEqual(0);
        expect(v.z, `${name} voxel z (${v.z}) out of bounds [0, ${d})`).toBeLessThan(d);

        // Hex color format
        expect(v.color, `${name} invalid color format`).toMatch(/^#[0-9a-fA-F]{6}$/);

        // Duplicate check
        const coordKey = `${v.x},${v.y},${v.z}`;
        expect(seenCoords.has(coordKey), `${name} has duplicate voxel at (${coordKey})`).toBe(false);
        seenCoords.add(coordKey);
      }
    }
  });

  it("generates readable ASCII layer previews for key entities", () => {
    const keys = ["hospital", "car_red", "boat", "helicopter"];
    for (const key of keys) {
      const preview = previewModel(key);
      expect(preview).toContain(`Voxel Model: ${key}`);
      expect(preview).toContain("Layer Y=0:");
      expect(preview).toContain("█");
    }
  });

  it("throws friendly error when requesting an unknown model name", () => {
    expect(() => getModel("non_existent_spaceship")).toThrow(/not found/);
  });
});
