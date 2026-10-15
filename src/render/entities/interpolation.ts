/** One snapshot's worth of an entity column set. */
export interface Track {
  id: Int32Array;
  x: Float32Array;
  z: Float32Array;
  heading: Float32Array;
}

export interface Sample {
  x: number;
  z: number;
  heading: number;
}

/** Beyond this (cells) between snapshots we snap instead of sliding. */
const TELEPORT = 4;

export const lerpAngle = (a: number, b: number, t: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/**
 * Keeps the last two snapshots of an entity set and samples positions
 * between them. Rendering runs one snapshot behind the sim, which is what
 * buys smooth motion at any tick rate.
 */
export class Interpolator {
  private prev: Track | null = null;
  private curr: Track | null = null;
  private prevIndex = new Map<number, number>();
  private currIndex = new Map<number, number>();
  private prevTime = 0;
  private currTime = 0;

  push(track: Track, time: number): void {
    this.prev = this.curr;
    this.prevIndex = this.currIndex;
    this.prevTime = this.currTime;
    this.curr = track;
    this.currTime = time;
    this.currIndex = new Map();
    for (let i = 0; i < track.id.length; i++) this.currIndex.set(track.id[i], i);
  }

  /** Clears history so the next push renders without sliding (after seek/load). */
  reset(): void {
    this.prev = null;
    this.curr = null;
    this.prevIndex = new Map();
    this.currIndex = new Map();
  }

  get count(): number {
    return this.curr?.id.length ?? 0;
  }

  get current(): Track | null {
    return this.curr;
  }

  indexOf(id: number): number {
    return this.currIndex.get(id) ?? -1;
  }

  /** Blend factor 0..1 for wall time `now` (ms). */
  alpha(now: number): number {
    if (!this.prev) return 1;
    const span = Math.min(1500, Math.max(16, this.currTime - this.prevTime));
    return Math.min(1, Math.max(0, (now - this.currTime) / span));
  }

  sample(i: number, alpha: number, out: Sample): Sample {
    const c = this.curr as Track;
    const x1 = c.x[i];
    const z1 = c.z[i];
    const h1 = c.heading[i];
    const j = this.prev ? this.prevIndex.get(c.id[i]) : undefined;
    if (j === undefined || !this.prev) {
      out.x = x1;
      out.z = z1;
      out.heading = h1;
      return out;
    }
    const x0 = this.prev.x[j];
    const z0 = this.prev.z[j];
    if (Math.abs(x1 - x0) + Math.abs(z1 - z0) > TELEPORT) {
      out.x = x1;
      out.z = z1;
      out.heading = h1;
      return out;
    }
    out.x = x0 + (x1 - x0) * alpha;
    out.z = z0 + (z1 - z0) * alpha;
    out.heading = lerpAngle(this.prev.heading[j], h1, alpha);
    return out;
  }
}
