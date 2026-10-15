import { describe, expect, it } from "vitest";
import { BlockType, NpcRole, VehicleKind } from "../contracts";
import {
  BLOCK_META,
  BLOCK_PALETTE,
  ROLE_PALETTE,
  VEHICLE_PALETTE,
  WATER_PALETTE,
  applyPowerOffTint,
  getBlockColor,
  getWaterColorForDepth,
  variation,
} from "./palette";

describe("Palette and Block Metadata", () => {
  it("defines a palette color and metadata for every BlockType", () => {
    const blockTypes = Object.values(BlockType).filter((v) => typeof v === "number") as BlockType[];
    expect(blockTypes.length).toBeGreaterThan(0);

    for (const type of blockTypes) {
      const color = BLOCK_PALETTE[type];
      expect(color, `Missing color for BlockType.${BlockType[type]}`).toBeDefined();
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);

      const meta = BLOCK_META[type];
      expect(meta, `Missing metadata for BlockType.${BlockType[type]}`).toBeDefined();
      expect(meta.name).toBeTruthy();
      expect(meta.icon).toBeTruthy();
      expect(meta.heightVoxels).toBeGreaterThanOrEqual(0);
      expect(typeof meta.walkable).toBe("boolean");
      expect(typeof meta.drivable).toBe("boolean");
      expect(typeof meta.solid).toBe("boolean");
    }
  });

  it("produces deterministic, bounded color variation in [-0.04, 0.04]", () => {
    for (let cell = 0; cell < 1000; cell++) {
      const v = variation(cell);
      expect(v).toBeGreaterThanOrEqual(-0.04);
      expect(v).toBeLessThanOrEqual(0.04);
      expect(variation(cell)).toBe(v); // determinism
    }
  });

  it("computes varied block color with valid hex format", () => {
    const baseColor = getBlockColor(BlockType.Grass);
    const variedColor = getBlockColor(BlockType.Grass, 42);
    expect(baseColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(variedColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("categorizes water depths into proper color buckets", () => {
    expect(getWaterColorForDepth(0.1)).toBe(WATER_PALETTE.shallow);
    expect(getWaterColorForDepth(0.3)).toBe(WATER_PALETTE.shallow);
    expect(getWaterColorForDepth(0.5)).toBe(WATER_PALETTE.medium);
    expect(getWaterColorForDepth(0.9)).toBe(WATER_PALETTE.deep);
    expect(getWaterColorForDepth(1.5)).toBe(WATER_PALETTE.torrential);
  });

  it("covers all NPC roles and vehicle kinds", () => {
    const roles = Object.values(NpcRole).filter((v) => typeof v === "number") as NpcRole[];
    for (const role of roles) {
      expect(ROLE_PALETTE[role]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }

    const vehicles = Object.values(VehicleKind).filter((v) => typeof v === "number") as VehicleKind[];
    for (const kind of vehicles) {
      const col = VEHICLE_PALETTE[kind];
      expect(col).toBeDefined();
    }
  });

  it("applies power-off darkening tint properly", () => {
    const lit = "#ffffff";
    const dark = applyPowerOffTint(lit);
    expect(dark).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(dark).not.toBe(lit);
  });
});
