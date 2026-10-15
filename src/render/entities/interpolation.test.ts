import { describe, expect, it } from 'vitest';
import { Interpolator, lerpAngle, type Sample, type Track } from './interpolation';

const track = (ids: number[], xs: number[], headings: number[] = ids.map(() => 0)): Track => ({
  id: Int32Array.from(ids),
  x: Float32Array.from(xs),
  z: Float32Array.from(xs.map(() => 0)),
  heading: Float32Array.from(headings),
});

describe('Interpolator', () => {
  it('lerps matching ids between the last two snapshots', () => {
    const it2 = new Interpolator();
    it2.push(track([1, 2], [0, 10]), 0);
    it2.push(track([2, 1], [12, 1]), 100);
    const out: Sample = { x: 0, z: 0, heading: 0 };
    const a = it2.alpha(150);
    expect(a).toBeCloseTo(0.5);
    expect(it2.sample(it2.indexOf(1), a, out).x).toBeCloseTo(0.5);
    expect(it2.sample(it2.indexOf(2), a, out).x).toBeCloseTo(11);
  });

  it('snaps new entities and teleports', () => {
    const it2 = new Interpolator();
    it2.push(track([1], [0]), 0);
    it2.push(track([1, 3], [50, 7]), 100);
    const out: Sample = { x: 0, z: 0, heading: 0 };
    expect(it2.sample(0, 0.1, out).x).toBe(50);
    expect(it2.sample(1, 0.1, out).x).toBe(7);
  });

  it('takes the short way round for headings', () => {
    expect(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5)).toBeCloseTo(Math.PI, 5);
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4);
  });
});
