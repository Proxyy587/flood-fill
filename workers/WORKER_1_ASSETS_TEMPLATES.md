# WORKER 1 — Voxel Assets and Scenario Templates

Read `AGENTS.md`, `docs/CONTRACTS.md` and `docs/SIM_SPEC.md` §1, §2, §12 first.

## Your lane
**You may edit only:**
- `src/assets/**`
- `scenarios/**`
- `scripts/validate-scenarios.ts`
- `docs/REQUESTS.md` (append only)

Do **not** touch `src/sim`, `src/render`, `src/editor`, `src/ui`, `src/contracts` (read only).

## Mission
Give the city its look and its starting points: the voxel models and palette, and the scenario JSON templates that the sim and editor load.

## Task A: Palette and block definitions (first 2 hours)
Create `src/assets/palette.ts`:
- One flat colour per `BlockType`, with a small deterministic per-block variation function `variation(cellIndex) → [-0.04, 0.04]`.
- Water colours by depth bucket (shallow → deep). Power-off tint. Selection/highlight colours.
- Role colours for NPCs (civilian, police, boat operator, paramedic, doctor, nurse, pilot) and vehicle colours.
- Export `BLOCK_META: Record<BlockType, { name, icon, category, heightVoxels, walkable, drivable, solid }>`. The editor hotbar and sim read this, so get it right.

## Task B: Voxel models (hours 2–8)
Create `src/assets/models/*.ts`. Each model is data, not meshes:

```ts
export interface VoxelModel {
  name: string;
  size: [number, number, number];             // x, y, z voxels
  voxels: { x: number; y: number; z: number; color: string }[];  // or a palette-indexed array
  pivot: [number, number, number];
}
```

Needed (keep each ≤ ~200 voxels, readable from above at small size):
- **Buildings:** house (2 variants), apartment, office, shop, hospital (red cross on the roof), police station (blue), flood HQ (distinct antenna tower), boat depot (with a visible boat), shelter (green), helipad (H marking), substation, power plant, drainage grate, tree (2 variants), levee/sandbag.
- **Vehicles:** car (3 colours), ambulance, police car, boat (rescue), helicopter (rotor as a separate model for animation).
- **People:** a small voxel person, with a colour per role (≤ 12 voxels).

Rules: no textures, no external assets, no images. Write a tiny `previewModel(name)` that prints an ASCII layer-by-layer view for quick checking, and a `models.test.ts` asserting every model fits its declared size and has no duplicate voxels.

## Task C: Scenario templates (hours 8–16, in parallel with M1/M2)
Write a generator script `scripts/gen-scenarios.ts` that **procedurally produces** the JSON in `scenarios/` (hand-writing 96×96 arrays is a waste). Templates, per `docs/SIM_SPEC.md` §12:

1. `riverside-town.json`: 64×64. A river with one bridge, two hospitals on different sides, a shelter, a police station, a flood HQ, a boat depot. A teaching example.
2. `coastal-grid.json`: 96×96. A flat grid street layout, poor drainage, a flash-flood-prone low zone.
3. `dense-basin-city.json`: 96×96. A bowl-shaped terrain (the centre is lowest), 3 hospitals, a power-critical substation in a low cell, 2 helipads, 6 districts.
4. `stress-triple.json`: based on #3 with injected events: bridge closure + boat failure + shelter overflow + substation flood blackout + helicopter grounding gale wind.

Requirements for every template:
- Validates against the `Scenario` Zod schema (`pnpm validate`).
- Has `districts` (≥ 4) with cell lists for the fairness metric.
- Has a plausible `weather` timeline (a quiet period of ≥ 5 sim-minutes so the city is seen alive, then rain, then peak).
- Roads are connected (write a test: every house/hospital/shelter has a road path to every hospital, in the dry state).
- Reserves low terrain next to drainage so drainage placement matters.
- Deterministic: the same seed produces byte-identical JSON.

## Task D: README for assets (last 2 hours)
`src/assets/README.md`: how to add a model, how to add a block, a screenshot-free description of every template.

## Done means
- [ ] `pnpm validate` passes for all templates
- [ ] `models.test.ts` passes
- [ ] every `BlockType` has palette and meta entries (a test asserts this)
- [ ] ASCII previews exist for hospital, car, boat, helicopter
- [ ] a line in `docs/CHANGELOG.md` per task

## If blocked
Use `docs/REQUESTS.md`: `[W1 → AK] need X because Y`. Keep going with a mock.
