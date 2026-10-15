import * as THREE from 'three';
import { BlockType, PowerState, VehicleKind, type RenderSnapshot, type WorldSnapshot } from '../../contracts';
import type { Lens } from '../../bridge/sceneStore';
import { LENSES, type Stop } from '../lenses';

const KERNEL_R = 3;
const KERNEL_SIGMA = 1.4;
/** Traffic memory: presence decays with this time constant (ticks). */
const TRAFFIC_TAU = 600;
/** People per cell that saturates the people ramp (≈ 1,000 people per hectare). */
const PEOPLE_FULL = 1.6;
const EXPOSURE_FULL = 0.6;
const ROAD_VEHICLES = new Set<number>([VehicleKind.Car, VehicleKind.Bus, VehicleKind.Ambulance, VehicleKind.PoliceCar]);

const kernel = (() => {
  const size = KERNEL_R * 2 + 1;
  const k = new Float32Array(size * size);
  let sum = 0;
  for (let dz = -KERNEL_R; dz <= KERNEL_R; dz++) {
    for (let dx = -KERNEL_R; dx <= KERNEL_R; dx++) {
      const v = Math.exp(-(dx * dx + dz * dz) / (2 * KERNEL_SIGMA * KERNEL_SIGMA));
      k[(dz + KERNEL_R) * size + dx + KERNEL_R] = v;
      sum += v;
    }
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
})();

const unpack = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

/** Samples a continuous ramp at t in [0, 1]. */
const sampleRamp = (stops: readonly Stop[], t: number, out: Uint8Array, o: number): void => {
  if (t <= stops[0][0]) {
    const [r, g, b] = unpack(stops[0][1]);
    out.set([r, g, b, Math.round(stops[0][2] * 255)], o);
    return;
  }
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1, a1] = stops[i];
    if (t > t1 && i < stops.length - 1) continue;
    const [t0, c0, a0] = stops[i - 1];
    const k = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-6, t1 - t0)));
    const [r0, g0, b0] = unpack(c0);
    const [r1, g1, b1] = unpack(c1);
    out[o] = r0 + (r1 - r0) * k;
    out[o + 1] = g0 + (g1 - g0) * k;
    out[o + 2] = b0 + (b1 - b0) * k;
    out[o + 3] = (a0 + (a1 - a0) * k) * 255;
    return;
  }
};

/** Picks the highest band whose threshold `t` is met; transparent below the first. */
const sampleBands = (stops: readonly Stop[], v: number, out: Uint8Array, o: number): void => {
  let hit = -1;
  for (let i = 0; i < stops.length; i++) if (v >= stops[i][0]) hit = i;
  if (hit < 0) {
    out.set([0, 0, 0, 0], o);
    return;
  }
  const [r, g, b] = unpack(stops[hit][1]);
  out.set([r, g, b, Math.round(stops[hit][2] * 255)], o);
};

/**
 * Analysis lenses. Keeps live per-cell fields (people, traffic memory) and
 * paints the active one into a texture that patched materials project from
 * above onto every surface, while the rest of the city fades to paper grey.
 */
export class LensLayer {
  /** Shared by every patched material, so one update reaches all of them. */
  readonly uniforms = {
    lensMap: { value: null as THREE.DataTexture | null },
    lensSize: { value: new THREE.Vector2(1, 1) },
    lensMix: { value: 0 },
  };
  private lens: Lens = 'none';
  private texture: THREE.DataTexture | null = null;
  private pixels = new Uint8Array(4);
  private people = new Float32Array(0);
  private scratch = new Float32Array(0);
  private traffic = new Float32Array(0);
  private trafficScale = 4;
  private lastTick = -1;
  private world: WorldSnapshot | null = null;
  private snapshot: RenderSnapshot | null = null;

  setWorld(world: WorldSnapshot): void {
    const resized = !this.world || this.world.w !== world.w || this.world.h !== world.h;
    this.world = world;
    if (!resized) return;
    const n = world.w * world.h;
    this.people = new Float32Array(n);
    this.scratch = new Float32Array(n);
    this.traffic = new Float32Array(n);
    this.pixels = new Uint8Array(n * 4);
    this.texture?.dispose();
    this.texture = new THREE.DataTexture(this.pixels, world.w, world.h, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
    this.uniforms.lensMap.value = this.texture;
    this.uniforms.lensSize.value.set(world.w, world.h);
  }

  setLens(lens: Lens): void {
    this.lens = lens;
    this.paint();
  }

  /** Folds a new snapshot into the live fields; always runs so lenses have history when opened. */
  setSnapshot(s: RenderSnapshot): void {
    const w = this.world;
    if (!w || s.water.length !== w.w * w.h) return;
    this.snapshot = s;
    if (s.tick < this.lastTick || s.tick === 0) this.traffic.fill(0);
    const dt = this.lastTick < 0 ? 1 : Math.max(0, s.tick - this.lastTick);
    this.lastTick = s.tick;

    // People: kernel density of live positions, eased so it breathes rather than flickers.
    this.scratch.fill(0);
    this.splat(this.scratch, s.npcs.x, s.npcs.z, null);
    const ease = 0.35;
    for (let i = 0; i < this.people.length; i++) this.people[i] += (this.scratch[i] - this.people[i]) * ease;

    // Traffic: decaying memory of road-vehicle presence.
    if (dt > 0) {
      const decay = Math.exp(-dt / TRAFFIC_TAU);
      let max = 0;
      for (let i = 0; i < this.traffic.length; i++) {
        this.traffic[i] *= decay;
        if (this.traffic[i] > max) max = this.traffic[i];
      }
      const v = s.vehicles;
      for (let i = 0; i < v.id.length; i++) {
        if (!ROAD_VEHICLES.has(v.kind[i])) continue;
        const c = this.cellOf(v.x[i], v.z[i]);
        if (c >= 0) this.traffic[c] += dt;
      }
      this.trafficScale += (Math.max(60, max * 0.7) - this.trafficScale) * 0.05;
    }
    this.paint();
  }

  /** Eases the grey-out in and out; call every frame. */
  update(dt: number): void {
    const goal = this.lens === 'none' ? 0 : 1;
    const u = this.uniforms.lensMix;
    u.value += (goal - u.value) * (1 - Math.exp(-dt * 7));
    if (Math.abs(goal - u.value) < 0.002) u.value = goal;
  }

  /** Projects the lens texture onto a material from above. */
  patch(material: THREE.Material, strength = 1): void {
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.lensMap = uniforms.lensMap;
      shader.uniforms.lensSize = uniforms.lensSize;
      shader.uniforms.lensMix = uniforms.lensMix;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLensWorld;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvLensWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLensWorld;\nuniform sampler2D lensMap;\nuniform vec2 lensSize;\nuniform float lensMix;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if (lensMix > 0.001) {
            vec4 lensC = texture2D(lensMap, vLensWorld.xz / lensSize);
            float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            vec3 paper = vec3(0.86, 0.88, 0.87) * (0.72 + 0.28 * lum);
            diffuseColor.rgb = mix(diffuseColor.rgb, paper, lensMix * ${strength.toFixed(2)});
            diffuseColor.rgb = mix(diffuseColor.rgb, lensC.rgb, lensC.a * lensMix);
          }`,
        );
    };
    material.customProgramCacheKey = () => `lens-${strength}`;
    material.needsUpdate = true;
  }

  dispose(): void {
    this.texture?.dispose();
  }

  // ---------- internals ----------

  private cellOf(x: number, z: number): number {
    const w = this.world;
    if (!w) return -1;
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    return cx < 0 || cz < 0 || cx >= w.w || cz >= w.h ? -1 : cz * w.w + cx;
  }

  private splat(field: Float32Array, xs: Float32Array, zs: Float32Array, weight: ((i: number) => number) | null): void {
    const w = this.world;
    if (!w) return;
    const size = KERNEL_R * 2 + 1;
    for (let i = 0; i < xs.length; i++) {
      const wt = weight ? weight(i) : 1;
      if (wt <= 0) continue;
      const cx = Math.floor(xs[i]);
      const cz = Math.floor(zs[i]);
      for (let dz = -KERNEL_R; dz <= KERNEL_R; dz++) {
        const z = cz + dz;
        if (z < 0 || z >= w.h) continue;
        for (let dx = -KERNEL_R; dx <= KERNEL_R; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= w.w) continue;
          field[z * w.w + x] += kernel[(dz + KERNEL_R) * size + dx + KERNEL_R] * wt;
        }
      }
    }
  }

  private paint(): void {
    const w = this.world;
    const s = this.snapshot;
    const tex = this.texture;
    if (!w || !tex || this.lens === 'none') return;
    const px = this.pixels;
    const n = w.w * w.h;
    const spec = LENSES[this.lens];
    for (let c = 0; c < n; c++) {
      // DataTexture rows run bottom-up in UV space; row z maps to v = z / h, so no flip is needed.
      const o = c * 4;
      switch (this.lens) {
        case 'people':
          sampleRamp(spec.stops, Math.sqrt(Math.min(1, this.people[c] / PEOPLE_FULL)), px, o);
          break;
        case 'traffic':
          sampleRamp(spec.stops, Math.sqrt(Math.min(1, this.traffic[c] / this.trafficScale)), px, o);
          break;
        case 'depth':
          sampleBands(spec.stops, s && w.blocks[c] !== BlockType.WaterSource ? s.water[c] : 0, px, o);
          break;
        case 'exposure': {
          const d = s && w.blocks[c] !== BlockType.WaterSource ? s.water[c] : 0;
          const hazard = d < 0.1 ? 0 : Math.min(1, 0.25 + d);
          sampleRamp(spec.stops, Math.sqrt(Math.min(1, (this.people[c] * hazard) / EXPOSURE_FULL)), px, o);
          break;
        }
        case 'power': {
          const p = s ? (s.powered[c] as PowerState) : PowerState.Grid;
          sampleBands(spec.stops, p === PowerState.Grid ? 0 : p === PowerState.Generator ? 1 : 2, px, o);
          break;
        }
      }
    }
    tex.needsUpdate = true;
  }
}
