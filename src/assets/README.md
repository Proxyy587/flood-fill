# Voxel Assets, Palettes & Scenario Templates

This directory houses the deterministic voxel asset pipeline, procedural model definitions, color palettes, and scenario authoring tools for **FloodSim**.

---

## 1. Palette & Material System (`palette.ts`)

The simulation visual language is governed by a unified color palette:
- **Terrain & Blocks (`PALETTE`)**: Hex colors for each `BlockType` (Grass, Sand, Road, Levee, Helipad, PowerPlant, etc.).
- **Deterministic Color Variation (`variation(cellIndex, baseColor, amount)`)**: Applies subtle perceptual luminance shifting per cell using a deterministic hash (`(cellIndex * 2654435761) >>> 0`), preventing repetitive tiling while remaining 100% pure and reproducible across headless and browser runs.
- **Water Depth Visual Buckets (`WATER_DEPTH_PALETTE`)**: Discrete color ramps matching simulation flood levels (`dry`, `shallow < 0.2m`, `wading 0.2-0.5m`, `flooded 0.5-1.2m`, `deep > 1.2m`).
- **Emergency & Civilian Roles (`ROLE_PALETTE`)**: Dedicated colors for all 10 `NpcRole` uniforms (Civilian, Driver, Police, Doctor, Nurse, Pilot, Dispatcher, etc.).
- **Vehicle Kinds (`VEHICLE_PALETTE`)**: Color schemes for Car, Bus, Ambulance, PoliceCar, Boat, Helicopter, and Rotor blades.
- **Block Metadata Table (`BLOCK_META`)**: Authoritative properties per block: `isSolid`, `isWalkable`, `isDrivable`, `baseHeight`, `defaultCapacity`, and human-readable names.

---

## 2. Voxel Model Pipeline (`models/`)

All models are authored as procedural, zero-dependency `VoxelModel` objects:

```ts
export interface Voxel {
  x: number;
  y: number;
  z: number;
  color: string;
}

export interface VoxelModel {
  name: string;
  size: [number, number, number]; // [width, height, depth]
  voxels: Voxel[];
  pivot?: [number, number, number];
}
```

### Model Directory
- **`buildings.ts`**: Procedural structures (`house_v1`, `house_v2`, `apartment`, `office`, `shop`, `hospital`, `police_station`, `flood_hq`, `boat_depot`, `shelter`, `helipad`, `substation`, `power_plant`, `drainage`, `tree_v1`, `tree_v2`, `levee`).
- **`vehicles.ts`**: Compact vehicle models (`car_red`, `car_blue`, `car_yellow`, `bus`, `ambulance`, `police_car`, `boat`, `helicopter`, `helicopter_rotor`).
- **`people.ts`**: 10 distinct, role-colored character figures ($\le 12$ voxels) matching `NpcRole`.
- **`builder.ts`**: `VoxelBuilder` helper ensuring zero duplicate voxels on overlapping layers and clear overwrite semantics.
- **`preview.ts`**: ASCII layer visualizer (`previewModel(model)`) for headless debugging and fast CLI inspection.
- **`index.ts`**: Central registry `MODELS` and `getModel(name)`.

### How to Add a New Voxel Model
1. Choose or create a category builder file in `src/assets/models/` (e.g. `buildings.ts` or `vehicles.ts`).
2. Use `VoxelBuilder` to set voxels and coordinate boxes with palette colors:
   ```ts
   import { VoxelBuilder } from "./builder";
   import { PALETTE } from "../palette";
   import type { VoxelModel } from "./types";

   export function createMyNewModel(): VoxelModel {
     const b = new VoxelBuilder();
     // Base foundation (x: 0..2, y: 0, z: 0..2)
     b.box(0, 0, 0, 3, 1, 3, PALETTE.Rock);
     // Roof accent
     b.set(1, 1, 1, PALETTE.Hospital);
     return b.build("my_new_model", [3, 2, 3]);
   }
   ```
3. Register the model in `src/assets/models/index.ts` inside `MODELS`.
4. Run or write unit tests in `src/assets/models/models.test.ts` to ensure coordinate non-negativity, dimension bounds, and coordinate uniqueness:
   ```bash
   pnpm test src/assets/models
   ```

### How to Add a New Block Type
1. Propose and add the new enum member to `BlockType` in `src/contracts/types.ts` (requires team alignment per AGENTS.md).
2. Assign its base hex color and default palette values in `src/assets/palette.ts` (`PALETTE`).
3. Add the complete metadata entry into `BLOCK_META` (setting `isSolid`, `isDrivable`, `isWalkable`, etc.).
4. If the block has 3D volume or building footprint, author its procedural voxel model in `src/assets/models/buildings.ts`.
5. Run the palette and model test suite:
   ```bash
   pnpm test src/assets
   ```

---

## 3. Scenario Templates (`scenarios/`)

Generated via `scripts/gen-scenarios.ts` and validated against `ScenarioSchema`. Each template satisfies all Problem Statement 27 requirements: multi-district layouts, minimum 300-tick dry/quiet calibration period, power grids, flood hazards, and dry road connectivity between all shelters, houses, and medical centers.

### 1. `riverside-town.json` (64×64, 4 Districts)
A picturesque valley divided by a central river flowing north to south. The West Bank features elevated civic headquarters, a medical center, and residential slopes, while the East Bank contains commercial markets, an emergency shelter, and waterfront boat depots. A 6-cell arterial bridge connects the two banks across the river channel.

**Stress conditions & PS requirements**:
- **River overflow & bridge collapse**: At tick 1,500, floodwaters breach the riverbanks and the central bridge is severed (`bridge_closed`).
- Tests **dynamic re-planning** on a partitioned road graph, forcing agents to route to opposite river banks via rescue boat depots or deploy emergency evacuation protocols.

### 2. `coastal-grid.json` (96×96, 4 Districts)
An expansive coastal urban grid fronting a southern ocean. Features an inland medical trauma center, waterfront clinic, elevated residential shelter, coastal levee protection walls, and a low-elevation central retention basin prone to flash pooling.

**Stress conditions & PS requirements**:
- **Compound storm surge & flash flooding**: Extreme 0.95-intensity rain bursts pool in the depression basin while ocean surge sources breach low-lying beach roads.
- Injected debris blocks central grid intersections (`road_blocked_by_debris`), testing **flow-field navigation**, water depth vehicle limits, and drainage pump efficiency.

### 3. `dense-basin-city.json` (96×96, 6 Districts)
A high-density metropolitan bowl surrounded by steep mountain ridges with a central floodplain lake. Contains 3 tier-balanced hospitals (North Highlands with helipad, West Valley clinic, Southeast Ridge center), a downtown civic helipad, power plant on the high ridge, and a critical electrical substation seated in the bottom of the basin.

**Stress conditions & PS requirements**:
- **Topographical drainage & power dependency**: Water flows naturally into the bowl bottom where the low-elevation substation resides.
- Exercises **hospital patient load balancing**, multi-district **fairness invariants (Gini index)** across 6 socioeconomic zones, and backup generator transitions.

### 4. `stress-triple.json` (96×96, 6 Districts)
The ultimate benchmark scenario for Problem Statement 27, combining multi-system cascading failures occurring simultaneously at tick 1,200.

**Simultaneous stress events**:
- **Arterial bridge cut**: Central access bridge severed (`bridge_closed`).
- **Rescue boat mechanical breakdown**: First responder watercraft disabled (`boat_failure`).
- **Shelter overcrowding**: Primary civic shelter declared at overflow capacity (`shelter_overflow`).
- **Grid blackout**: Central basin substation is submerged (`substation_flooded`), cutting grid power to downstream hospitals and triggering emergency generator timers.
- **Severe weather aviation grounding**: Gale force winds (28 m/s) ground all emergency helicopters (`helicopter_grounded_wind`).
- **Sensor communications degradation**: Radio blackout and uncertainty-tagged false incident reports (`comms_outage`, `false_report`).

---

## 4. Scenario Generation & Verification

```bash
# Generate all 4 scenario JSONs and scenarios/index.json
pnpm tsx scripts/gen-scenarios.ts

# Validate all scenario files against Zod schemas
pnpm validate --require-templates

# Run full asset, palette, model, and connectivity tests
pnpm test src/assets
```
