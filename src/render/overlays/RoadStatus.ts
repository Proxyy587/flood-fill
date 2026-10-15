import * as THREE from 'three';
import { BlockType, VehicleKind, ZONE, type RenderSnapshot, type WorldSnapshot } from '../../contracts';
import { entityMaterial, GLOW, Kit, type EntityUniforms } from '../entities/models';
import { Y_SCALE } from '../units';

const MAX_BARRICADES = 400;
const MAX_DETOUR = 1200;
const MAX_PRONE = 2400;
const MAX_DEBRIS = 200;
const ROAD_VEHICLES = new Set<number>([VehicleKind.Car, VehicleKind.Bus, VehicleKind.Ambulance, VehicleKind.PoliceCar]);

/** Red-and-white police barricade on A-frame legs with a lamp; the board spans z. */
const barricadeGeometry = (): THREE.BufferGeometry => {
  const k = new Kit();
  for (const s of [-1, 1]) {
    k.box(0.03, 0.07, s * 0.3, 0.025, 0.14, 0.025, 0x5d6166);
    k.box(-0.03, 0.07, s * 0.3, 0.025, 0.14, 0.025, 0x5d6166);
  }
  for (let i = 0; i < 5; i++) k.box(0, 0.15, -0.288 + i * 0.144, 0.03, 0.07, 0.144, i % 2 ? 0xf4f4f4 : 0xd62f2f);
  k.box(0, 0.205, 0.3, 0.04, 0.04, 0.04, 0xffb300, { glow: GLOW.lamp });
  k.box(0, 0.205, -0.3, 0.04, 0.04, 0.04, 0xffb300, { glow: GLOW.lamp });
  return k.build();
};

const debrisGeometry = (): THREE.BufferGeometry => {
  const k = new Kit();
  const rocks: [number, number, number, number, number][] = [
    [0, 0.08, 0, 0.55, 0.16],
    [-0.22, 0.12, 0.18, 0.3, 0.24],
    [0.2, 0.1, -0.2, 0.34, 0.2],
    [0.25, 0.06, 0.25, 0.22, 0.12],
    [-0.25, 0.07, -0.22, 0.26, 0.14],
    [0.02, 0.2, 0.05, 0.22, 0.14],
  ];
  rocks.forEach(([x, y, z, s, h], i) => k.box(x, y, z, s, h, s * 0.9, i % 2 ? 0x7a6450 : 0x8c8378));
  k.box(0, 0.015, 0, 0.98, 0.03, 0.98, 0x6b5442);
  return k.build();
};

const DETOUR_VERTEX = /* glsl */ `
attribute float aDir;
varying vec2 vUv;
varying float vDir;
void main() {
  vUv = uv;
  vDir = aDir;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

/** Amber chevrons that drift along the diverted road (dashes where the direction is unknown). */
const DETOUR_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
varying float vDir;
void main() {
  float across = abs(vUv.x - 0.5);
  float along = vDir < -0.5 ? 1.0 - vUv.y : vUv.y;
  float shape = abs(vDir) > 0.5 ? along * 3.0 + across * 1.6 : along * 3.0;
  float d = fract(shape - uTime * 0.6);
  float a = smoothstep(0.0, 0.08, d) * (1.0 - smoothstep(0.3, 0.38, d));
  a *= 1.0 - smoothstep(0.38, 0.5, across);
  gl_FragColor = vec4(uColor, a * uOpacity);
}`;

const PRONE_VERTEX = /* glsl */ `
attribute float aEdge;
varying vec2 vUv;
varying vec3 vWorld;
varying float vEdge;
void main() {
  vUv = uv;
  vEdge = aEdge;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** Diagonal yellow hatch with a solid outline on the zone's outer edges. */
const PRONE_FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vWorld;
varying float vEdge;
void main() {
  float hatch = step(0.62, fract((vWorld.x + vWorld.z) * 1.6));
  float e = 0.0;
  float m = vEdge;
  if (mod(m, 2.0) >= 1.0 && vUv.x > 0.93) e = 1.0;
  m = floor(m / 2.0);
  if (mod(m, 2.0) >= 1.0 && vUv.x < 0.07) e = 1.0;
  m = floor(m / 2.0);
  if (mod(m, 2.0) >= 1.0 && vUv.y < 0.07) e = 1.0;
  m = floor(m / 2.0);
  if (mod(m, 2.0) >= 1.0 && vUv.y > 0.93) e = 1.0;
  float a = max(hatch * 0.55, e) * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

/**
 * What the authorities are doing to the streets: police barricades where a
 * closure meets open road, drifting amber chevrons on diverted routes, a
 * hatched outline over areas named in the flood alert, and debris piles.
 */
export class RoadStatus {
  readonly group = new THREE.Group();
  private world: WorldSnapshot | null = null;
  private deck: Int16Array = new Int16Array(0);
  private barricades: THREE.InstancedMesh;
  private barricadeUniforms: EntityUniforms;
  private debris: THREE.InstancedMesh;
  private detour: THREE.InstancedMesh;
  private detourDir: THREE.InstancedBufferAttribute;
  private detourMat: THREE.ShaderMaterial;
  private prone: THREE.InstancedMesh;
  private proneEdge: THREE.InstancedBufferAttribute;
  private proneMat: THREE.ShaderMaterial;
  /** Last direction traffic was seen moving along each road cell (+1 / -1 along its axis). */
  private flow = new Int8Array(0);
  private dummy = new THREE.Object3D();

  constructor() {
    this.group.name = 'road-status';
    const bar = entityMaterial();
    this.barricadeUniforms = bar.uniforms;
    this.barricades = new THREE.InstancedMesh(barricadeGeometry(), bar.material, MAX_BARRICADES);
    this.barricades.castShadow = true;
    this.debris = new THREE.InstancedMesh(debrisGeometry(), entityMaterial().material, MAX_DEBRIS);
    this.debris.castShadow = true;

    const strip = new THREE.PlaneGeometry(0.34, 1).rotateX(-Math.PI / 2);
    this.detourDir = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DETOUR), 1);
    strip.setAttribute('aDir', this.detourDir);
    this.detourMat = new THREE.ShaderMaterial({
      vertexShader: DETOUR_VERTEX,
      fragmentShader: DETOUR_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.85 }, uColor: { value: new THREE.Color(0xffa31a) } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.detour = new THREE.InstancedMesh(strip, this.detourMat, MAX_DETOUR);
    this.detour.renderOrder = 3;

    const tile = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.proneEdge = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PRONE), 1);
    tile.setAttribute('aEdge', this.proneEdge);
    this.proneMat = new THREE.ShaderMaterial({
      vertexShader: PRONE_VERTEX,
      fragmentShader: PRONE_FRAGMENT,
      uniforms: { uOpacity: { value: 0.3 }, uColor: { value: new THREE.Color(0xf5c542) } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    this.prone = new THREE.InstancedMesh(tile, this.proneMat, MAX_PRONE);
    this.prone.renderOrder = 3;

    for (const m of [this.barricades, this.debris, this.detour, this.prone]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  setWorld(world: WorldSnapshot, deck: Int16Array): void {
    if (!this.world || this.world.w !== world.w || this.world.h !== world.h) this.flow = new Int8Array(world.w * world.h);
    this.world = world;
    this.deck = deck;
  }

  private topY(c: number): number {
    const w = this.world as WorldSnapshot;
    const d = this.deck[c];
    return (d >= 0 ? d : w.ground[c]) * Y_SCALE;
  }

  /** Rebuilds instances from the snapshot's zone flags. */
  setSnapshot(s: RenderSnapshot, surfaceAt: (c: number) => number): void {
    const w = this.world;
    const zones = s.zones;
    if (!w || !zones || zones.length !== w.w * w.h) {
      for (const m of [this.barricades, this.debris, this.detour, this.prone]) m.count = 0;
      return;
    }
    this.learnFlow(s);
    const { w: W, h: H } = w;
    const flag = (x: number, z: number, bit: number) => x >= 0 && z >= 0 && x < W && z < H && (zones[z * W + x] & bit) !== 0;
    const isRoad = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H && (w.blocks[z * W + x] === BlockType.Road || w.blocks[z * W + x] === BlockType.Bridge);
    let nb = 0;
    let nd = 0;
    let nt = 0;
    let np = 0;
    const d = this.dummy;
    for (let c = 0; c < zones.length; c++) {
      const f = zones[c];
      if (!f) continue;
      const x = c % W;
      const z = (c - x) / W;
      const y = this.topY(c);
      if (f & ZONE.barricade && nb < MAX_BARRICADES) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (!flag(x + dx, z + dz, ZONE.closed) || nb >= MAX_BARRICADES) continue;
          d.position.set(x + 0.5 + dx * 0.36, y + 0.01, z + 0.5 + dz * 0.36);
          d.rotation.set(0, dx !== 0 ? 0 : Math.PI / 2, 0);
          d.scale.setScalar(1);
          d.updateMatrix();
          this.barricades.setMatrixAt(nb++, d.matrix);
        }
      }
      if (f & (ZONE.debris | ZONE.breach) && nd < MAX_DEBRIS) {
        d.position.set(x + 0.5, w.ground[c] * Y_SCALE, z + 0.5);
        d.rotation.set(0, ((c * 2654435761) % 628) / 100, 0);
        d.scale.set(1, f & ZONE.breach ? 0.6 : 1.4, 1);
        d.updateMatrix();
        this.debris.setMatrixAt(nd++, d.matrix);
      }
      if (f & ZONE.detour && !(f & ZONE.closed) && nt < MAX_DETOUR && w.blocks[c] === BlockType.Road) {
        const alongX = isRoad(x + 1, z) || isRoad(x - 1, z);
        const alongZ = isRoad(x, z + 1) || isRoad(x, z - 1);
        const dir = this.flow[c];
        const axisX = alongX === alongZ ? Math.abs(dir) !== 2 : alongX;
        d.position.set(x + 0.5, Math.max(y, surfaceAt(c)) + 0.025, z + 0.5);
        d.rotation.set(0, axisX ? -Math.PI / 2 : 0, 0);
        d.scale.setScalar(1);
        d.updateMatrix();
        this.detour.setMatrixAt(nt, d.matrix);
        // Flow is ±1 along x and ±2 along z; the strip's +v points to -z, or +x once turned.
        const sign = axisX ? (Math.abs(dir) === 1 ? Math.sign(dir) : 0) : Math.abs(dir) === 2 ? Math.sign(dir) : 0;
        this.detourDir.setX(nt, axisX ? sign : -sign);
        nt++;
      }
      if (f & ZONE.prone && np < MAX_PRONE) {
        d.position.set(x + 0.5, Math.max(y, surfaceAt(c)) + 0.03, z + 0.5);
        d.rotation.set(0, 0, 0);
        d.scale.setScalar(1);
        d.updateMatrix();
        this.prone.setMatrixAt(np, d.matrix);
        const edge = (flag(x + 1, z, ZONE.prone) ? 0 : 1) | (flag(x - 1, z, ZONE.prone) ? 0 : 2) | (flag(x, z - 1, ZONE.prone) ? 0 : 4) | (flag(x, z + 1, ZONE.prone) ? 0 : 8);
        this.proneEdge.setX(np, edge);
        np++;
      }
    }
    this.barricades.count = nb;
    this.debris.count = nd;
    this.detour.count = nt;
    this.prone.count = np;
    for (const m of [this.barricades, this.debris, this.detour, this.prone]) m.instanceMatrix.needsUpdate = true;
    this.detourDir.needsUpdate = true;
    this.proneEdge.needsUpdate = true;
  }

  /** Remembers which way road traffic moves through each cell, for the chevrons. */
  private learnFlow(s: RenderSnapshot): void {
    const w = this.world as WorldSnapshot;
    const v = s.vehicles;
    for (let i = 0; i < v.id.length; i++) {
      if (!ROAD_VEHICLES.has(v.kind[i])) continue;
      const x = Math.floor(v.x[i]);
      const z = Math.floor(v.z[i]);
      if (x < 0 || z < 0 || x >= w.w || z >= w.h) continue;
      const cx = Math.cos(v.heading[i]);
      const cz = Math.sin(v.heading[i]);
      this.flow[z * w.w + x] = Math.abs(cx) >= Math.abs(cz) ? (cx > 0 ? 1 : -1) : cz > 0 ? 2 : -2;
    }
  }

  update(now: number, night: number): void {
    this.barricadeUniforms.uNight.value = night;
    this.barricadeUniforms.uTime.value = now / 1000;
    this.detourMat.uniforms.uTime.value = now / 1000;
    this.proneMat.uniforms.uOpacity.value = 0.26 + 0.08 * Math.sin(now / 900);
  }

  dispose(): void {
    for (const m of [this.barricades, this.debris, this.detour, this.prone]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
