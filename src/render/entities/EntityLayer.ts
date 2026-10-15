import * as THREE from 'three';
import { NpcRole, NpcState, VEHICLE_KIND_COUNT, VehicleKind, VehicleState, type EntityRef, type RenderSnapshot } from '../../contracts';
import { CAR_COLORS, CIVILIAN_SHIRTS, ROLE_COLORS, STRANDED_COLOR } from '../palette';
import { hash01, Y_SCALE } from '../units';
import { Interpolator, type Sample } from './interpolation';
import { entityMaterial, personGeometry, rotorGeometry, ROTOR_HUB_Y, vehicleGeometry } from './models';

/** Ground height (world units) at a point; supplied by the scene. */
export type HeightFn = (x: number, z: number) => number;
/** Water surface (world units) at a point, or -Infinity when dry. */
export type WaterFn = (x: number, z: number) => number;

const HELI_CRUISE = 9;
const AIRBORNE = new Set<number>([VehicleState.Flying, VehicleState.Returning, VehicleState.Responding, VehicleState.Transporting]);
/** Stride phase per world unit walked (1 unit = 4 m, about 5 strides). */
const STRIDE = 32;
/** Speed (units/s, interpolated) at which the walk cycle reaches full swing. */
const FULL_SWING_SPEED = 0.12;

class Pool {
  mesh: THREE.InstancedMesh;
  /** Per-instance (phase, amplitude, wave) for the walk cycle, when the pool animates limbs. */
  walk: THREE.InstancedBufferAttribute | null = null;
  private capacity = 0;

  constructor(
    private geometry: THREE.BufferGeometry,
    private material: THREE.Material,
    private parent: THREE.Group,
    private shadows: boolean,
    private animated = false,
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
    if (this.animated) {
      this.walk = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      this.walk.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute('walk', this.walk);
    }
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
  private vehicleMat = entityMaterial();
  private personMat = entityMaterial({ walk: true });
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
  /** Walk-cycle state by npc index, re-keyed when the id at an index changes. */
  private stepId = new Int32Array(0);
  private stepX = new Float32Array(0);
  private stepZ = new Float32Array(0);
  private stepPhase = new Float32Array(0);
  private stepAmp = new Float32Array(0);
  private lastNow = 0;

  constructor() {
    this.group.name = 'entities';
    this.npcPool = new Pool(personGeometry(), this.personMat.material, this.group, false, true);
    this.vehiclePools = Array.from({ length: VEHICLE_KIND_COUNT }, (_, k) => new Pool(vehicleGeometry(k as VehicleKind), this.vehicleMat.material, this.group, true));
    this.rotorPool = new Pool(rotorGeometry(), this.vehicleMat.material, this.group, false);
  }

  /** 0 by day, 1 at night: headlights, tail lamps and cockpit lights. */
  setNight(night: number): void {
    this.vehicleMat.uniforms.uNight.value = night;
    this.personMat.uniforms.uNight.value = night;
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
    this.vehicleMat.uniforms.uTime.value = now / 1000;
    this.personMat.uniforms.uTime.value = now / 1000;
    this.updateNpcs(now, groundY);
    this.updateVehicles(now, dt, groundY, waterY);
  }

  private growSteps(n: number): void {
    if (this.stepId.length >= n) return;
    const grow = <T extends Int32Array | Float32Array>(a: T, make: (len: number) => T): T => {
      const b = make(n * 2);
      b.set(a);
      return b;
    };
    this.stepId = grow(this.stepId, (l) => new Int32Array(l).fill(-1));
    this.stepX = grow(this.stepX, (l) => new Float32Array(l));
    this.stepZ = grow(this.stepZ, (l) => new Float32Array(l));
    this.stepPhase = grow(this.stepPhase, (l) => new Float32Array(l));
    this.stepAmp = grow(this.stepAmp, (l) => new Float32Array(l));
  }

  private updateNpcs(now: number, groundY: HeightFn): void {
    const n = this.npcs.count;
    const mesh = this.npcPool.ensure(n);
    const walk = this.npcPool.walk;
    if (this.npcPos.length < n * 3) this.npcPos = new Float32Array(n * 3 * 2);
    this.growSteps(n);
    const a = this.npcs.alpha(now);
    const ids = this.npcs.current?.id;
    const dt = Math.min(0.1, Math.max(1e-3, (now - this.lastNow) / 1000));
    this.lastNow = now;
    const ease = 1 - Math.exp(-dt * 8);
    for (let i = 0; i < n; i++) {
      const s = this.npcs.sample(i, a, this.sample);
      const id = ids ? ids[i] : i;
      const stranded = this.npcState[i] === NpcState.Stranded;
      const y = groundY(s.x, s.z);
      this.dummy.position.set(s.x, y, s.z);
      this.dummy.rotation.set(0, -s.heading, 0);
      this.dummy.scale.setScalar(stranded ? 1.2 : 1);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      const role = this.npcRole[i] as NpcRole;
      const shirt = role === NpcRole.Civilian ? CIVILIAN_SHIRTS[Math.floor(hash01(id) * CIVILIAN_SHIRTS.length)] : (ROLE_COLORS[role] ?? 0xffffff);
      this.color.setHex(stranded ? STRANDED_COLOR : shirt);
      mesh.setColorAt(i, this.color);

      if (this.stepId[i] !== id) {
        this.stepId[i] = id;
        this.stepPhase[i] = hash01(id) * Math.PI * 2;
        this.stepAmp[i] = 0;
      } else {
        const moved = Math.hypot(s.x - this.stepX[i], s.z - this.stepZ[i]);
        this.stepPhase[i] = (this.stepPhase[i] + (stranded ? dt * 6 : moved * STRIDE)) % (Math.PI * 200);
        const target = Math.min(1, moved / dt / FULL_SWING_SPEED);
        this.stepAmp[i] += (target - this.stepAmp[i]) * ease;
      }
      this.stepX[i] = s.x;
      this.stepZ[i] = s.z;
      walk?.setXYZ(i, this.stepPhase[i], this.stepAmp[i] * 0.75, stranded ? 1 : 0);

      this.npcPos[i * 3] = s.x;
      this.npcPos[i * 3 + 1] = y + 0.3;
      this.npcPos[i * 3 + 2] = s.z;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (walk) walk.needsUpdate = true;
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
    this.vehicleMat.material.dispose();
    this.personMat.material.dispose();
  }
}
