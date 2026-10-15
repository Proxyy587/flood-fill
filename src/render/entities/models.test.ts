import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLE_KIND_COUNT, VehicleKind } from '../../contracts';
import { GLOW, INSTANCE_TINT_LINE, Kit, PART, PERSON_PIVOT, ROTOR_HUB_Y, maskedColorVertex, personGeometry, rotorGeometry, vehicleGeometry } from './models';

const bounds = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

const KINDS = Array.from({ length: VEHICLE_KIND_COUNT }, (_, k) => k as VehicleKind);

/** Every triangle's winding agrees with its vertex normals (faces point outward). */
const outward = (g: THREE.BufferGeometry): boolean => {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const idx = g.getIndex()!;
  const [a, b, c, e1, e2, nn] = Array.from({ length: 6 }, () => new THREE.Vector3());
  for (let t = 0; t < idx.count; t += 3) {
    const [i, j, k] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, j);
    c.fromBufferAttribute(p, k);
    e1.subVectors(b, a).cross(e2.subVectors(c, a));
    if (e1.lengthSq() < 1e-14) continue;
    if (e1.dot(nn.fromBufferAttribute(n, i)) <= 0) return false;
  }
  return true;
};

const attrValues = (g: THREE.BufferGeometry, name: string): Set<number> => {
  const a = g.getAttribute(name);
  return new Set(Array.from({ length: a.count }, (_, i) => a.getX(i)));
};

describe('toy entity models', () => {
  it('builds outward-facing geometry with every entity attribute for each kind', () => {
    for (const g of [...KINDS.map(vehicleGeometry), personGeometry(), rotorGeometry()]) {
      const n = g.getAttribute('position').count;
      expect(n).toBeGreaterThan(0);
      for (const a of ['normal', 'color', 'tintMask', 'glow', 'part']) expect(g.getAttribute(a).count).toBe(n);
      expect(outward(g)).toBe(true);
      g.dispose();
    }
  });

  it('closes cylinders the right way round on both axes', () => {
    expect(outward(new Kit().cyl(0, 0, 0, 0.1, 0.05, 0xffffff, 'y').build())).toBe(true);
    expect(outward(new Kit().cyl(0, 0, 0, 0.1, 0.05, 0xffffff, 'z').build())).toBe(true);
  });

  it('faces +x and stands on the ground, with headlights at the front', () => {
    for (const k of [VehicleKind.Car, VehicleKind.Bus, VehicleKind.Ambulance, VehicleKind.PoliceCar]) {
      const g = vehicleGeometry(k);
      const b = bounds(g);
      expect(b.min.y).toBeCloseTo(0, 2);
      expect(b.max.x - b.min.x).toBeGreaterThan(b.max.z - b.min.z);
      const p = g.getAttribute('position');
      const col = g.getAttribute('color');
      const glow = g.getAttribute('glow');
      let front = 0;
      for (let i = 0; i < p.count; i++) if (glow.getX(i) === GLOW.lamp && col.getZ(i) > 0.25 && p.getX(i) > 0) front++;
      for (let i = 0; i < p.count; i++) if (glow.getX(i) === GLOW.lamp && col.getZ(i) > 0.25) expect(p.getX(i)).toBeGreaterThan(0);
      expect(front).toBeGreaterThan(0);
      g.dispose();
    }
  });

  it('keeps a car about half a cell long and a person under half a cell tall', () => {
    const car = bounds(vehicleGeometry(VehicleKind.Car));
    expect(car.max.x - car.min.x).toBeCloseTo(0.58, 1);
    const person = bounds(personGeometry());
    expect(person.max.y).toBeLessThan(0.5);
    expect(person.max.y).toBeGreaterThan(0.35);
  });

  it('gives people four swinging limbs below the shoulder and a tinted shirt', () => {
    const g = personGeometry();
    expect([...attrValues(g, 'part')].sort()).toEqual([PART.body, PART.armL, PART.armR, PART.legL, PART.legR]);
    const part = g.getAttribute('part');
    const pos = g.getAttribute('position');
    for (let i = 0; i < part.count; i++) if (part.getX(i) !== PART.body) expect(pos.getY(i)).toBeLessThanOrEqual(PERSON_PIVOT.shoulder + 0.001);
    const mask = attrValues(g, 'tintMask');
    expect(mask.has(0) && mask.has(1)).toBe(true);
  });

  it('flashes beacons on emergency vehicles only', () => {
    for (const k of KINDS) {
      const beacons = attrValues(vehicleGeometry(k), 'glow').has(GLOW.beaconA) || attrValues(vehicleGeometry(k), 'glow').has(GLOW.beaconB);
      expect(beacons).toBe(k !== VehicleKind.Car && k !== VehicleKind.Bus);
    }
  });

  it('puts the rotor hub on top of the mast, with blades wider than the body', () => {
    expect(ROTOR_HUB_Y).toBeCloseTo(bounds(vehicleGeometry(VehicleKind.Helicopter)).max.y, 1);
    expect(bounds(rotorGeometry()).max.x).toBeGreaterThan(0.5);
  });

  it('patches the instance-colour line of this three.js version', () => {
    expect(THREE.ShaderChunk.color_vertex).toContain(INSTANCE_TINT_LINE);
    expect(maskedColorVertex()).toContain('tintMask');
    expect(THREE.ShaderChunk.begin_vertex).toContain('vec3 transformed = vec3( position );');
    expect(THREE.ShaderLib.lambert.fragmentShader).toContain('#include <opaque_fragment>');
  });
});
