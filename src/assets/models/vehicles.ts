import type { VoxelModel } from "./types";
import { VoxelBuilder } from "./builder";

// -------------------------------------------------------------
// Passenger Car (available in 3 distinct colors)
// -------------------------------------------------------------
export function createCar(name: string, bodyColor: string): VoxelModel {
  const b = new VoxelBuilder();
  // Underbody
  b.box(1, 0, 1, 1, 0, 3, "#485460");
  // Wheels (y = 0)
  b.set(0, 0, 1, "#1e272e");
  b.set(2, 0, 1, "#1e272e");
  b.set(0, 0, 3, "#1e272e");
  b.set(2, 0, 3, "#1e272e");

  // Bumpers & lights
  b.box(0, 0, 0, 2, 0, 0, bodyColor);
  b.box(0, 0, 4, 2, 0, 4, bodyColor);
  b.set(0, 0, 0, "#f1c40f"); // headlight left
  b.set(2, 0, 0, "#f1c40f"); // headlight right
  b.set(0, 0, 4, "#e74c3c"); // taillight left
  b.set(2, 0, 4, "#e74c3c"); // taillight right

  // Body hood, cabin base, trunk
  b.box(0, 1, 0, 2, 1, 0, bodyColor); // hood
  b.box(0, 1, 1, 2, 1, 1, "#74b9ff"); // windshield
  b.box(0, 1, 2, 2, 1, 2, bodyColor); // doors
  b.box(0, 1, 3, 2, 1, 3, "#74b9ff"); // rear glass
  b.box(0, 1, 4, 2, 1, 4, bodyColor); // trunk

  // Roof (y = 2)
  b.box(0, 2, 1, 2, 2, 3, bodyColor);

  return {
    name,
    size: [3, 3, 5],
    voxels: b.build(),
    pivot: [1, 0, 2],
  };
}

// -------------------------------------------------------------
// City Bus
// -------------------------------------------------------------
export function createBus(): VoxelModel {
  const b = new VoxelBuilder();
  // Chassis base
  b.box(0, 0, 0, 2, 0, 6, "#2c3e50");
  // Wheels
  b.set(0, 0, 1, "#1e272e");
  b.set(2, 0, 1, "#1e272e");
  b.set(0, 0, 5, "#1e272e");
  b.set(2, 0, 5, "#1e272e");

  // Orange bus body (y = 1)
  b.box(0, 1, 0, 2, 1, 6, "#f39c12");

  // Windows (y = 2)
  b.box(0, 2, 0, 2, 2, 6, "#f39c12");
  for (let z = 1; z <= 5; z++) {
    b.set(0, 2, z, "#dff9fb");
    b.set(2, 2, z, "#dff9fb");
  }
  b.set(1, 2, 0, "#dff9fb"); // windshield
  b.set(1, 2, 6, "#dff9fb"); // rear window

  // Roof (y = 3)
  b.box(0, 3, 0, 2, 3, 6, "#f1c40f");

  return {
    name: "bus",
    size: [3, 4, 7],
    voxels: b.build(),
    pivot: [1, 0, 3],
  };
}

// -------------------------------------------------------------
// Emergency Ambulance
// -------------------------------------------------------------
export function createAmbulance(): VoxelModel {
  const b = new VoxelBuilder();
  // Chassis
  b.box(0, 0, 0, 2, 0, 5, "#2c3e50");
  // Wheels
  b.set(0, 0, 1, "#1e272e");
  b.set(2, 0, 1, "#1e272e");
  b.set(0, 0, 4, "#1e272e");
  b.set(2, 0, 4, "#1e272e");

  // White medical chassis (y = 1..2)
  b.box(0, 1, 0, 2, 2, 5, "#f5f6fa");
  b.set(1, 2, 0, "#74b9ff"); // windshield

  // Red Cross emblem on sides
  b.set(0, 2, 3, "#e74c3c");
  b.set(2, 2, 3, "#e74c3c");

  // Emergency lightbar on roof (y = 3)
  b.set(0, 3, 1, "#e74c3c"); // red flashing light
  b.set(1, 3, 1, "#ffffff");
  b.set(2, 3, 1, "#0984e3"); // blue flashing light

  return {
    name: "ambulance",
    size: [3, 4, 6],
    voxels: b.build(),
    pivot: [1, 0, 2],
  };
}

// -------------------------------------------------------------
// Police Patrol Car
// -------------------------------------------------------------
export function createPoliceCar(): VoxelModel {
  const b = new VoxelBuilder();
  // Chassis
  b.box(0, 0, 0, 2, 0, 4, "#2c3e50");
  // Wheels
  b.set(0, 0, 1, "#1e272e");
  b.set(2, 0, 1, "#1e272e");
  b.set(0, 0, 3, "#1e272e");
  b.set(2, 0, 3, "#1e272e");

  // Body: Black front/rear, White doors
  b.box(0, 1, 0, 2, 1, 0, "#1e272e"); // hood
  b.box(0, 1, 4, 2, 1, 4, "#1e272e"); // trunk
  b.box(0, 1, 1, 0, 1, 3, "#ffffff"); // white side door
  b.box(2, 1, 1, 2, 1, 3, "#ffffff");
  b.box(1, 1, 1, 1, 1, 3, "#1e272e");

  // Roof & Glass
  b.set(1, 2, 1, "#74b9ff"); // windshield
  b.box(0, 2, 2, 2, 2, 2, "#1e272e"); // roof
  b.set(1, 2, 3, "#74b9ff"); // rear glass

  // Police roof lightbar (y = 3)
  b.set(0, 3, 2, "#e74c3c"); // red
  b.set(1, 3, 2, "#ffffff");
  b.set(2, 3, 2, "#0984e3"); // blue

  return {
    name: "police_car",
    size: [3, 4, 5],
    voxels: b.build(),
    pivot: [1, 0, 2],
  };
}

// -------------------------------------------------------------
// Rescue Boat
// -------------------------------------------------------------
export function createBoat(): VoxelModel {
  const b = new VoxelBuilder();
  // Pointed hull
  b.set(1, 0, 0, "#fa8231");
  b.set(1, 1, 0, "#fa8231");
  // Hull sides and bottom (z: 1..4)
  b.box(0, 0, 1, 2, 0, 4, "#eb3b5a"); // red bottom
  b.box(0, 1, 1, 0, 1, 4, "#fa8231"); // left gunwale
  b.box(2, 1, 1, 2, 1, 4, "#fa8231"); // right gunwale
  b.box(0, 1, 4, 2, 1, 4, "#fa8231"); // stern

  // Outboard motor at stern
  b.box(1, 1, 4, 1, 2, 4, "#2d3436");
  // Lifebuoy ring (white)
  b.set(1, 1, 2, "#ffffff");

  return {
    name: "boat",
    size: [3, 3, 5],
    voxels: b.build(),
    pivot: [1, 0, 2],
  };
}

// -------------------------------------------------------------
// Rescue Helicopter (Fuselage, skids, tail boom)
// -------------------------------------------------------------
export function createHelicopter(): VoxelModel {
  const b = new VoxelBuilder();
  // Landing skids (y = 0)
  b.box(0, 0, 1, 0, 0, 4, "#718093"); // left skid
  b.box(4, 0, 1, 4, 0, 4, "#718093"); // right skid
  b.set(1, 0, 2, "#718093"); // strut
  b.set(3, 0, 2, "#718093");

  // Main fuselage (y: 1..2, x: 1..3, z: 1..4)
  b.box(1, 1, 1, 3, 2, 4, "#e58e26"); // orange fuselage
  // Cockpit bubble (z = 1)
  b.box(1, 1, 1, 3, 2, 1, "#4bcffa");

  // Tail boom (x = 2, y = 2, z: 5..6)
  b.box(2, 2, 5, 2, 2, 6, "#e58e26");
  // Tail fin & tail rotor
  b.box(2, 3, 6, 2, 4, 6, "#e58e26");
  b.set(1, 3, 6, "#d2dae2"); // tail rotor blade

  // Main rotor mast (y = 3)
  b.set(2, 3, 2, "#2f3542");

  return {
    name: "helicopter",
    size: [5, 5, 7],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}

// -------------------------------------------------------------
// Helicopter Rotor (Separate model for dynamic spinning animation)
// -------------------------------------------------------------
export function createHelicopterRotor(): VoxelModel {
  const b = new VoxelBuilder();
  // Cross rotor blades 5x1x5
  b.box(0, 0, 2, 4, 0, 2, "#2f3542"); // horizontal blade
  b.box(2, 0, 0, 2, 0, 4, "#2f3542"); // vertical blade
  // Yellow safety tips
  b.set(0, 0, 2, "#f1c40f");
  b.set(4, 0, 2, "#f1c40f");
  b.set(2, 0, 0, "#f1c40f");
  b.set(2, 0, 4, "#f1c40f");

  return {
    name: "helicopter_rotor",
    size: [5, 1, 5],
    voxels: b.build(),
    pivot: [2, 0, 2],
  };
}
