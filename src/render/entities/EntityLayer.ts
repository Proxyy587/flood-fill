import * as THREE from 'three';
import { NpcState, VEHICLE_KIND_COUNT, VehicleKind, VehicleState, type EntityRef, type RenderSnapshot } from '../../contracts';
import { CAR_COLORS, ROLE_COLORS, STRANDED_COLOR } from '../palette';
import { hash01, Y_SCALE } from '../units';
import { Interpolator, type Sample } from './interpolation';
import { personGeometry, rotorGeometry, ROTOR_HUB_Y, vehicleGeometry } from './models';

/** Ground height (world units) at a point; supplied by the scene. */
export type HeightFn = (x: number, z: number) => number;
/** Water surface (world units) at a point, or -Infinity when dry. */
export type WaterFn = (x: number, z: number) => number;

const HELI_CRUISE = 9;
const AIRBORNE = new Set<number>([VehicleState.Flying, VehicleState.Returning, VehicleState.Responding, VehicleState.Transporting]);

class Pool {
  mesh: THREE.InstancedMesh;
  private capacity = 0;

  constructor(
    private geometry: THREE.BufferGeometry,
    private material: THREE.Material,
    private parent: THREE.Group,
    private shadows: boolean,
  ) {
    this.mesh = this.create(256);
  }

  ensure(n: number): THREE.InstancedMesh {
    if (n > this.capacity) {
      this.parent.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = this.create(Math.max(n, this.capacity * 2));
    }
    return this.mesh;
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
  }

  private create(capacity: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = this.shadows;
    this.capacity = capacity;
    this.parent.add(m);
    return m;
  }
}

/** All moving things, as instanced meshes, interpolated between snapshots. */
export class EntityLayer {
  readonly group = new THREE.Group();
  private material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private npcPool: Pool;
  private vehiclePools: Pool[];
  private rotorPool: Pool;
  private npcs = new Interpolator();
  private vehicles = new Interpolator();
  private npcRole: Uint8Array = new Uint8Array(0);
  private npcState: Uint8Array = new Uint8Array(0);
  private vehicleKind: Uint8Array = new Uint8Array(0);
  private vehicleState: Uint8Array = new Uint8Array(0);
  private altitude = new Map<number, number>();
  /** Last rendered world positions, for picking and camera follow. */
  private npcPos = new Float32Array(0);
  private vehiclePos = new Float32Array(0);
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private sample: Sample = { x: 0, z: 0, heading: 0 };
  private v3 = new THREE.Vector3();

  constructor() {
    this.group.name = 'entities';
    this.npcPool = new Pool(personGeometry(), this.material, this.group, false);
    this.vehiclePools = Array.from({ length: VEHICLE_KIND_COUNT }, (_, k) => new Pool(vehicleGeometry(k as VehicleKind), this.material, this.group, true));
    this.rotorPool = new Pool(rotorGeometry(), this.material, this.group, false);
  }

  setSnapshot(s: RenderSnapshot, now: number): void {
    this.npcs.push({ id: s.npcs.id, x: s.npcs.x, z: s.npcs.z, heading: s.npcs.heading }, now);
    this.vehicles.push({ id: s.vehicles.id, x: s.vehicles.x, z: s.vehicles.z, heading: s.vehicles.heading }, now);
    this.npcRole = s.npcs.role;
    this.npcState = s.npcs.state;
    this.vehicleKind = s.vehicles.kind;
    this.vehicleState = s.vehicles.state;
  }

  /** Drop interpolation history (after load/seek) so nothing slides across the map. */
  reset(): void {
    this.npcs.reset();
    this.vehicles.reset();
    this.altitude.clear();
  }

  update(now: number, dt: number, groundY: HeightFn, waterY: WaterFn): void {
    this.updateNpcs(now, groundY);
    this.updateVehicles(now, dt, groundY, waterY);
  }

  private updateNpcs(now: number, groundY: HeightFn): void {
    const n = this.npcs.count;
    const mesh = this.npcPool.ensure(n);
    if (this.npcPos.length < n * 3) this.npcPos = new Float32Array(n * 3 * 2);
    const a = this.npcs.alpha(now);
    const blink = Math.sin(now / 160) > 0;
    for (let i = 0; i < n; i++) {
      const s = this.npcs.sample(i, a, this.sample);
      const stranded = this.npcState[i] === NpcState.Stranded;
      const y = groundY(s.x, s.z) + (stranded && blink ? 0.04 : 0);
      this.dummy.position.set(s.x, y, s.z);
      this.dummy.rotation.set(0, -s.heading, 0);
      this.dummy.scale.setScalar(stranded ? 1.25 : 1);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.color.setHex(stranded ? STRANDED_COLOR : (ROLE_COLORS[this.npcRole[i] as keyof typeof ROLE_COLORS] ?? 0xffffff));
      mesh.setColorAt(i, this.color);
      this.npcPos[i * 3] = s.x;
      this.npcPos[i * 3 + 1] = y + 0.3;
      this.npcPos[i * 3 + 2] = s.z;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private updateVehicles(now: number, dt: number, groundY: HeightFn, waterY: WaterFn): void {
    const n = this.vehicles.count;
    const counts = new Array<number>(VEHICLE_KIND_COUNT).fill(0);
    for (let i = 0; i < n; i++) counts[this.vehicleKind[i]]++;
    const meshes = this.vehiclePools.map((p, k) => p.ensure(counts[k]));
    const rotors = this.rotorPool.ensure(counts[VehicleKind.Helicopter]);
    if (this.vehiclePos.length < n * 3) this.vehiclePos = new Float32Array(n * 3 * 2);
    counts.fill(0);
    let rotorCount = 0;
    const a = this.vehicles.alpha(now);
    const ids = this.vehicles.current?.id;
    for (let i = 0; i < n; i++) {
      const kind = this.vehicleKind[i] as VehicleKind;
      const state = this.vehicleState[i];
      const id = ids ? ids[i] : i;
      const s = this.vehicles.sample(i, a, this.sample);
      const ground = groundY(s.x, s.z);
      let y = ground;
      if (kind === VehicleKind.Boat) {
        const surf = waterY(s.x, s.z);
        y = (surf > ground ? surf : ground) + Math.sin(now / 400 + id) * 0.02;
      } else if (kind === VehicleKind.Helicopter) {
        const target = AIRBORNE.has(state) ? ground + HELI_CRUISE * Y_SCALE + 1.5 : ground;
        const prev = this.altitude.get(id) ?? target;
        const alt = prev + (target - prev) * (1 - Math.exp(-dt * 1.2));
        this.altitude.set(id, alt);
        y = alt;
      }
      this.dummy.position.set(s.x, y, s.z);
      this.dummy.rotation.set(0, -s.heading, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      const k = counts[kind]++;
      const mesh = meshes[kind];
      mesh.setMatrixAt(k, this.dummy.matrix);
      const stalled = state === VehicleState.Stalled;
      if (kind === VehicleKind.Car) this.color.setHex(CAR_COLORS[Math.floor(hash01(id) * CAR_COLORS.length)]);
      else this.color.setHex(0xffffff);
      if (stalled) this.color.multiplyScalar(0.45);
      mesh.setColorAt(k, this.color);

      if (kind === VehicleKind.Helicopter) {
        const airborne = y > ground + 0.05;
        const spin = state === VehicleState.Grounded ? 0 : airborne ? 28 : 6;
        this.dummy.position.set(s.x, y + ROTOR_HUB_Y, s.z);
        this.dummy.rotation.set(0, (now / 1000) * spin + id, 0);
        this.dummy.updateMatrix();
        rotors.setMatrixAt(rotorCount, this.dummy.matrix);
        rotors.setColorAt(rotorCount, this.color.setHex(0xffffff));
        rotorCount++;
      }
      this.vehiclePos[i * 3] = s.x;
      this.vehiclePos[i * 3 + 1] = y + 0.15;
      this.vehiclePos[i * 3 + 2] = s.z;
    }
    meshes.forEach((m, k) => {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    rotors.count = rotorCount;
    rotors.instanceMatrix.needsUpdate = true;
    if (rotors.instanceColor) rotors.instanceColor.needsUpdate = true;
  }

  /** World position of an entity as last rendered, or null when it is not in the scene. */
  positionOf(ref: EntityRef, out: THREE.Vector3): THREE.Vector3 | null {
    if (ref.kind === 'npc') {
      const i = this.npcs.indexOf(ref.id);
      return i < 0 ? null : out.set(this.npcPos[i * 3], this.npcPos[i * 3 + 1], this.npcPos[i * 3 + 2]);
    }
    if (ref.kind === 'vehicle') {
      const i = this.vehicles.indexOf(ref.id);
      return i < 0 ? null : out.set(this.vehiclePos[i * 3], this.vehiclePos[i * 3 + 1], this.vehiclePos[i * 3 + 2]);
    }
    return null;
  }

  /** Nearest entity to a screen point (CSS px), within `radius` px. */
  pick(camera: THREE.Camera, px: number, py: number, width: number, height: number, radius = 14): EntityRef | null {
    let best: EntityRef | null = null;
    let bestD = radius * radius;
    const test = (pos: Float32Array, count: number, ids: Int32Array | undefined, kind: 'npc' | 'vehicle') => {
      if (!ids) return;
      for (let i = 0; i < count; i++) {
        this.v3.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).project(camera);
        if (this.v3.z > 1) continue;
        const sx = ((this.v3.x + 1) / 2) * width;
        const sy = ((1 - this.v3.y) / 2) * height;
        const d = (sx - px) ** 2 + (sy - py) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { kind, id: ids[i] };
        }
      }
    };
    test(this.vehiclePos, this.vehicles.count, this.vehicles.current?.id, 'vehicle');
    test(this.npcPos, this.npcs.count, this.npcs.current?.id, 'npc');
    return best;
  }

  dispose(): void {
    this.npcPool.dispose();
    this.vehiclePools.forEach((p) => p.dispose());
    this.rotorPool.dispose();
    this.material.dispose();
  }
}
