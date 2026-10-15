// Small voxel-style models built from boxes with baked vertex colours.
// Worker 1's `src/assets/models` will replace these; the instanced layer only
// needs a BufferGeometry per kind.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VehicleKind } from '../../contracts';

type Part = [sx: number, sy: number, sz: number, x: number, y: number, z: number, color: number];

/** Parts are in model space: +x forward, +y up, origin at the ground under the centre. */
const build = (parts: Part[]): THREE.BufferGeometry => {
  const geoms = parts.map(([sx, sy, sz, x, y, z, color]) => {
    const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
    g.translate(x, y + sy / 2, z);
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
    return g;
  });
  const merged = mergeGeometries(geoms) ?? new THREE.BoxGeometry(0.2, 0.2, 0.2);
  geoms.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
};

/** Body tinted per instance (role colour); head stays skin-toned via a brighter base. */
export const personGeometry = (): THREE.BufferGeometry =>
  build([
    [0.12, 0.2, 0.16, 0, 0, 0, 0x3a3f4a],
    [0.13, 0.2, 0.2, 0, 0.2, 0, 0xffffff],
    [0.12, 0.12, 0.12, 0, 0.4, 0, 0xf1c9a5],
  ]);

const car = (body: number, roof: number, stripe?: number, light?: number): Part[] => [
  [0.56, 0.12, 0.28, 0, 0.04, 0, body],
  [0.3, 0.1, 0.24, -0.04, 0.16, 0, roof],
  [0.3, 0.06, 0.25, -0.04, 0.17, 0, 0x26323f],
  ...(stripe !== undefined ? ([[0.57, 0.04, 0.29, 0, 0.1, 0, stripe]] as Part[]) : []),
  ...(light !== undefined ? ([[0.08, 0.04, 0.16, -0.04, 0.26, 0, light]] as Part[]) : []),
  [0.1, 0.06, 0.3, 0.17, 0, 0, 0x1b1b1b],
  [0.1, 0.06, 0.3, -0.17, 0, 0, 0x1b1b1b],
];

export const vehicleGeometry = (kind: VehicleKind): THREE.BufferGeometry => {
  switch (kind) {
    case VehicleKind.Car:
      return build(car(0xffffff, 0xffffff));
    case VehicleKind.Ambulance:
      return build(car(0xf7f7f7, 0xf7f7f7, 0xe53935, 0xe53935));
    case VehicleKind.PoliceCar:
      return build(car(0x1f4fa8, 0xf2f2f2, undefined, 0x4aa3ff));
    case VehicleKind.Bus:
      return build([
        [0.9, 0.26, 0.3, 0, 0.04, 0, 0xf2c230],
        [0.86, 0.08, 0.31, 0, 0.18, 0, 0x26323f],
      ]);
    case VehicleKind.Boat:
      return build([
        [0.62, 0.1, 0.3, 0, -0.04, 0, 0xff7a1a],
        [0.12, 0.08, 0.3, 0.3, -0.02, 0, 0xff7a1a],
        [0.2, 0.14, 0.18, -0.1, 0.06, 0, 0xf5f5f5],
        [0.06, 0.06, 0.06, -0.24, 0.06, 0, 0x333333],
      ]);
    case VehicleKind.Helicopter:
      return build([
        [0.5, 0.24, 0.26, 0, 0.06, 0, 0xd8322b],
        [0.18, 0.14, 0.24, 0.24, 0.1, 0, 0x8fd3f0],
        [0.5, 0.06, 0.06, -0.45, 0.18, 0, 0xd8322b],
        [0.04, 0.16, 0.18, -0.68, 0.16, 0, 0xf5f5f5],
        [0.5, 0.03, 0.03, 0, 0, 0.13, 0x333333],
        [0.5, 0.03, 0.03, 0, 0, -0.13, 0x333333],
        [0.04, 0.06, 0.04, 0, 0.3, 0, 0x333333],
      ]);
  }
};

/** Main rotor, spun by the entity layer. Origin at the hub. */
export const rotorGeometry = (): THREE.BufferGeometry =>
  build([
    [1.3, 0.02, 0.06, 0, 0, 0, 0x2b2b2b],
    [0.06, 0.02, 1.3, 0, 0, 0, 0x2b2b2b],
  ]);

export const ROTOR_HUB_Y = 0.36;
