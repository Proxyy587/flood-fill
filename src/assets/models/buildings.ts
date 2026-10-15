import type { VoxelModel } from "./types";
import { VoxelBuilder } from "./builder";

// -------------------------------------------------------------
// 1. House Variant 1 (Cottage with pitched roof)
// -------------------------------------------------------------
export function createHouseV1(): VoxelModel {
  const b = new VoxelBuilder();
  // Walls 5x3x5 (x: 0..4, y: 0..2, z: 0..4)
  b.box(0, 0, 0, 4, 1, 4, "#d2b48c"); // tan walls
  b.box(1, 0, 0, 1, 1, 0, "#8b5a2b"); // door
  b.box(3, 1, 0, 3, 1, 0, "#87ceeb"); // front window
  b.box(0, 1, 2, 0, 1, 2, "#87ceeb"); // side window
  b.box(4, 1, 2, 4, 1, 2, "#87ceeb"); // side window
  // Pitched roof (y: 2, 3)
  b.box(0, 2, 0, 4, 2, 4, "#a0522d"); // eaves
  b.box(1, 3, 1, 3, 3, 3, "#8b3e2f"); // ridge

  return {
    name: "house_v1",
    size: [5, 4, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 2. House Variant 2 (Suburban home with chimney)
// -------------------------------------------------------------
export function createHouseV2(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 4, 1, 4, "#e0d5c1"); // cream walls
  b.box(2, 0, 0, 2, 1, 0, "#5c3a21"); // wood door
  b.box(1, 1, 0, 1, 1, 0, "#add8e6"); // window
  b.box(3, 1, 0, 3, 1, 0, "#add8e6"); // window
  b.box(0, 2, 0, 4, 2, 4, "#5a6b7c"); // slate roof base
  b.box(1, 3, 1, 3, 3, 3, "#425263"); // slate ridge
  b.box(3, 2, 3, 3, 4, 3, "#b22222"); // brick chimney (y: 2..4)

  return {
    name: "house_v2",
    size: [5, 5, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 3. Apartment (Multi-story residential)
// -------------------------------------------------------------
export function createApartment(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 4, 5, 4, "#a55d47"); // brick structure
  // Entrance at ground floor
  b.box(2, 0, 0, 2, 1, 0, "#333333");
  // Windows on floors 1, 2, 3, 4
  for (let y = 1; y <= 4; y++) {
    b.box(1, y, 0, 1, y, 0, "#cbe3fb");
    b.box(3, y, 0, 3, y, 0, "#cbe3fb");
    b.box(0, y, 2, 0, y, 2, "#cbe3fb");
    b.box(4, y, 2, 4, y, 2, "#cbe3fb");
  }
  // Roof parapet
  b.box(0, 5, 0, 4, 5, 4, "#7a4435");
  b.box(1, 5, 1, 3, 5, 3, "#555555"); // roof gravel

  return {
    name: "apartment",
    size: [5, 6, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 4. Office (Commercial tower)
// -------------------------------------------------------------
export function createOffice(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 4, 6, 4, "#2c3e50"); // steel columns
  // Glass facade panels
  for (let y = 1; y <= 5; y++) {
    b.box(1, y, 0, 3, y, 0, "#74b9ff");
    b.box(1, y, 4, 3, y, 4, "#74b9ff");
    b.box(0, y, 1, 0, y, 3, "#74b9ff");
    b.box(4, y, 1, 4, y, 3, "#74b9ff");
  }
  // Glass entrance
  b.box(1, 0, 0, 3, 1, 0, "#dfe6e9");
  // Rooftop AC unit
  b.box(1, 7, 1, 2, 7, 2, "#636e72");

  return {
    name: "office",
    size: [5, 8, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 5. Shop (Storefront with awning)
// -------------------------------------------------------------
export function createShop(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 4, 3, 4, "#f5cd79"); // warm yellow plaster
  b.box(1, 0, 0, 3, 1, 0, "#81ecec"); // wide display window
  b.box(0, 0, 0, 0, 1, 0, "#596275"); // doorway
  // Striped awning over front
  b.box(0, 2, 0, 0, 2, 1, "#e15f41");
  b.box(1, 2, 0, 1, 2, 1, "#ffffff");
  b.box(2, 2, 0, 2, 2, 1, "#e15f41");
  b.box(3, 2, 0, 3, 2, 1, "#ffffff");
  b.box(4, 2, 0, 4, 2, 1, "#e15f41");

  return {
    name: "shop",
    size: [5, 4, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 6. Hospital (Red cross on roof)
// -------------------------------------------------------------
export function createHospital(): VoxelModel {
  const b = new VoxelBuilder();
  // White clinical building 5x4x5
  b.box(0, 0, 0, 4, 3, 4, "#ecf0f1");
  // Automatic sliding glass doors
  b.box(2, 0, 0, 2, 1, 0, "#0984e3");
  // Medical cross sign on front wall
  b.box(2, 2, 0, 2, 2, 0, "#d63031");
  // Windows
  b.box(0, 1, 1, 0, 2, 3, "#74b9ff");
  b.box(4, 1, 1, 4, 2, 3, "#74b9ff");
  // Red cross clearly visible on the roof (y = 4)
  b.box(0, 4, 0, 4, 4, 4, "#bdc3c7"); // grey roof surface
  // Red Cross pattern:
  b.box(2, 4, 1, 2, 4, 3, "#e74c3c"); // vertical arm
  b.box(1, 4, 2, 3, 4, 2, "#e74c3c"); // horizontal arm

  return {
    name: "hospital",
    size: [5, 5, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 7. Police Station (Blue badge accents + radio mast)
// -------------------------------------------------------------
export function createPoliceStation(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 4, 3, 4, "#2c3e50"); // dark blue masonry
  b.box(0, 1, 0, 4, 1, 0, "#0984e3"); // blue accent stripe
  b.box(2, 0, 0, 2, 1, 0, "#ffffff"); // secure front entrance
  b.box(0, 3, 0, 4, 3, 4, "#34495e"); // roof
  b.box(3, 4, 3, 3, 5, 3, "#95a5a6"); // radio antenna mast
  b.box(3, 5, 3, 3, 5, 3, "#e74c3c"); // red aviation beacon

  return {
    name: "police_station",
    size: [5, 6, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 8. Flood HQ (Emergency Command Centre with Antenna Array)
// -------------------------------------------------------------
export function createFloodHQ(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 4, 3, 4, "#34495e"); // reinforced command shelter
  b.box(1, 0, 0, 3, 1, 0, "#f39c12"); // high-visibility entrance
  b.box(0, 4, 0, 4, 4, 4, "#2c3e50");
  b.box(2, 4, 2, 2, 6, 2, "#e67e22"); // communication antenna tower
  b.box(1, 6, 2, 3, 6, 2, "#ffffff"); // radar dish / crossbar
  b.box(2, 6, 1, 2, 6, 3, "#ffffff");

  return {
    name: "flood_hq",
    size: [5, 7, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 9. Boat Depot (Waterfront slipway with rescue boat)
// -------------------------------------------------------------
export function createBoatDepot(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 0, 3, 4, "#4b6584"); // left wall
  b.box(4, 0, 0, 4, 3, 4, "#4b6584"); // right wall
  b.box(1, 0, 4, 3, 3, 4, "#4b6584"); // back wall
  b.box(0, 3, 0, 4, 3, 4, "#2c3e50"); // roof
  b.box(1, 0, 0, 3, 0, 3, "#805b38"); // dock wooden ramp
  b.box(1, 1, 1, 3, 1, 3, "#ff6b6b"); // orange rescue hull
  b.box(2, 2, 2, 2, 2, 2, "#ffffff"); // helm / cabin

  return {
    name: "boat_depot",
    size: [5, 4, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 10. Emergency Shelter (Green roof community hall)
// -------------------------------------------------------------
export function createShelter(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 5, 2, 4, "#dcdde1"); // civic hall walls
  b.box(2, 0, 0, 3, 1, 0, "#2f3640"); // wide double doors
  b.box(0, 3, 0, 5, 3, 4, "#2ed573"); // prominent green shelter roof
  b.box(1, 4, 1, 4, 4, 3, "#10ac84"); // pitched roof ridge

  return {
    name: "shelter",
    size: [6, 5, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 11. Helipad (H marking)
// -------------------------------------------------------------
export function createHelipad(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 4, 0, 4, "#57606f"); // concrete pad
  b.box(0, 0, 0, 0, 0, 0, "#f1c40f"); // corners
  b.box(4, 0, 0, 4, 0, 0, "#f1c40f");
  b.box(0, 0, 4, 0, 0, 4, "#f1c40f");
  b.box(4, 0, 4, 4, 0, 4, "#f1c40f");
  // "H" marking in white (layer y = 1)
  b.box(1, 1, 1, 1, 1, 3, "#ffffff");
  b.box(3, 1, 1, 3, 1, 3, "#ffffff");
  b.box(2, 1, 2, 2, 1, 2, "#ffffff");

  return {
    name: "helipad",
    size: [5, 2, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 12. Electrical Substation (Transformers & Insulators)
// -------------------------------------------------------------
export function createSubstation(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 4, 0, 4, "#7f8c8d"); // gravel foundation
  b.box(1, 1, 1, 1, 2, 2, "#27ae60"); // transformers
  b.box(3, 1, 1, 3, 2, 2, "#27ae60");
  b.box(1, 3, 1, 1, 3, 1, "#f39c12"); // bushings
  b.box(1, 3, 2, 1, 3, 2, "#f39c12");
  b.box(3, 3, 1, 3, 3, 1, "#f39c12");
  b.box(3, 3, 2, 3, 3, 2, "#f39c12");
  b.box(0, 1, 3, 4, 1, 3, "#95a5a6"); // gantry frame

  return {
    name: "substation",
    size: [5, 4, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 13. Power Plant (Turbine hall & cooling chimney)
// -------------------------------------------------------------
export function createPowerPlant(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 3, 3, 4, "#485460"); // turbine hall
  b.box(0, 2, 0, 3, 2, 0, "#e74c3c"); // red warning stripe
  b.box(4, 0, 1, 5, 4, 3, "#d2dae2"); // cooling stack
  b.box(4, 5, 1, 5, 5, 3, "#ff5e57"); // red rim

  return {
    name: "power_plant",
    size: [6, 6, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 14. Drainage Grate (Stormwater inlet)
// -------------------------------------------------------------
export function createDrainage(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 4, 0, 4, "#2d3436");
  b.box(1, 0, 1, 3, 0, 1, "#636e72");
  b.box(1, 0, 2, 3, 0, 2, "#000000"); // dark opening
  b.box(1, 0, 3, 3, 0, 3, "#636e72");

  return {
    name: "drainage",
    size: [5, 1, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 15. Tree Variant 1 (Deciduous canopy)
// -------------------------------------------------------------
export function createTreeV1(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(2, 0, 2, 2, 2, 2, "#5d4037"); // trunk
  b.box(1, 3, 1, 3, 4, 3, "#2e7d32"); // canopy
  b.box(0, 3, 2, 4, 3, 2, "#388e3c");
  b.box(2, 3, 0, 2, 3, 4, "#388e3c");
  b.box(2, 5, 2, 2, 5, 2, "#43a047"); // crown

  return {
    name: "tree_v1",
    size: [5, 6, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 16. Tree Variant 2 (Pine / Conifer)
// -------------------------------------------------------------
export function createTreeV2(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(2, 0, 2, 2, 1, 2, "#4e342e"); // trunk
  b.box(0, 2, 0, 4, 2, 4, "#1b5e20"); // bottom tier
  b.box(1, 3, 1, 3, 3, 3, "#2e7d32"); // middle tier
  b.box(1, 4, 1, 3, 4, 3, "#2e7d32");
  b.box(2, 5, 2, 2, 6, 2, "#388e3c"); // pine tip

  return {
    name: "tree_v2",
    size: [5, 7, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// 17. Levee / Sandbag Barrier
// -------------------------------------------------------------
export function createLevee(): VoxelModel {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 4, 0, 2, "#795548"); // base
  b.box(0, 1, 0, 4, 1, 1, "#d7ccc8"); // mid sandbags
  b.box(0, 2, 0, 4, 2, 0, "#bcaaa4"); // top sandbags

  return {
    name: "levee",
    size: [5, 3, 3],
    voxels: b.build(),
    pivot: [2, 0, 1],
  };
}
