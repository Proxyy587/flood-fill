import { BlockType } from "../../contracts/types";
import type { WeatherDef } from "../../contracts/types";
import type { World } from "../world/grid";

interface FloodInput {
  /** Depth added per cell per simulated second, in metres. */
  rain: number; sources: WeatherDef["sources"]; tick: number;
  soakRate?: number; drainRate?: number; coefficient?: number; pumpsNeedPower?: boolean;
}
export function totalWater(world: World): number {
  let total = 0; for (const depth of world.water) total += depth; return total;
}

/** Closed-boundary virtual pipes. Every outgoing volume is applied to its neighbour. */
export function stepFlood(w: World, input: FloodInput) {
  const { rain, sources, tick, soakRate = 0.00001, drainRate = 0.02, coefficient = 0.08, pumpsNeedPower = false } = input;
  if (![rain, tick, soakRate, drainRate, coefficient].every(Number.isFinite) || rain < 0 || rain > 1 || !Number.isInteger(tick) || tick < 0 || soakRate < 0 || drainRate < 0 || coefficient < 0 || coefficient > 0.25) throw new RangeError("Invalid flood parameters");
  const before = totalWater(w); let added = 0; let removed = 0;
  const length = w.water.length;
  // Validate every input before mutation; these limits provide Float32 headroom
  // for all 86400 supported ticks even if every source feeds the same cell.
  if (sources.length > 16384) throw new RangeError("Too many flood sources");
  for (const source of sources) if (!Number.isInteger(source.cell) || source.cell < 0 || source.cell >= length || !Number.isFinite(source.rate) || source.rate < 0 || source.rate > 1000 || !Number.isSafeInteger(source.startT) || !Number.isSafeInteger(source.endT) || source.startT < 0 || source.endT <= source.startT) throw new RangeError("Invalid flood source");
  if (!w.water.every((v) => Number.isFinite(v) && v >= 0 && v <= 1e20) || !w.flow.every(Number.isFinite)) throw new RangeError("Invalid flood state");
  for (let i = 0; i < length; i++) {
    const permeability = w.block[i] === BlockType.Grass || w.block[i] === BlockType.Sand ? 0.8 : 1;
    const amount = rain * permeability;
    w.water[i] += amount; added += amount;
  }
  for (const source of sources) {
    if (tick >= source.startT && tick < source.endT) { w.water[source.cell] += source.rate; added += source.rate; }
  }
  w.scratch.fill(0);
  const sills = new Float64Array(4);
  for (let i = 0; i < length; i++) {
    const x = i % w.width; const z = Math.floor(i / w.width);
    const surface = w.ground[i] + w.water[i];
    const sillHere = w.ground[i] + w.barrier[i] + (w.block[i] === BlockType.Levee ? 1 : 0);
    let outgoing = 0;
    for (let dir = 0; dir < 4; dir++) {
      const j = dir === 0 ? i - w.width : dir === 1 ? i + 1 : dir === 2 ? i + w.width : i - 1;
      const boundary = dir === 0 ? z === 0 : dir === 1 ? x === w.width - 1 : dir === 2 ? z === w.height - 1 : x === 0;
      const slot = i * 4 + dir;
      if (boundary) { w.flow[slot] = 0; sills[dir] = Infinity; continue; }
      const sillThere = w.ground[j] + w.barrier[j] + (w.block[j] === BlockType.Levee ? 1 : 0);
      sills[dir] = Math.max(sillHere, sillThere);
      const head = surface - Math.max(w.ground[j] + w.water[j], sills[dir]);
      w.flow[slot] = surface <= sills[dir] ? 0 : Math.max(0, 0.9 * w.flow[slot] + coefficient * head);
      outgoing += w.flow[slot];
    }
    let scale = outgoing > 0 ? Math.min(1, w.water[i] / outgoing) : 0;
    // Every sill tier has its own accessible-volume constraint. A single
    // conservative multiplier satisfies all four without allocating per cell.
    for (let dir = 0; dir < 4; dir++) {
      if (!Number.isFinite(sills[dir])) continue;
      let tierOutflow = 0;
      for (let other = 0; other < 4; other++) if (sills[other] >= sills[dir]) tierOutflow += w.flow[i * 4 + other];
      if (tierOutflow > 0) scale = Math.min(scale, Math.max(0, surface - sills[dir]) / tierOutflow);
    }
    for (let dir = 0; dir < 4; dir++) {
      const amount = w.flow[i * 4 + dir] * scale;
      w.flow[i * 4 + dir] = amount;
      if (amount === 0) continue;
      const j = dir === 0 ? i - w.width : dir === 1 ? i + 1 : dir === 2 ? i + w.width : i - 1;
      w.scratch[i] -= amount; w.scratch[j] += amount;
    }
  }
  for (let i = 0; i < length; i++) {
    const value = Math.max(0, w.water[i] + w.scratch[i]);
    const soak = w.block[i] === BlockType.Grass || w.block[i] === BlockType.Sand || w.block[i] === BlockType.Dirt ? soakRate : 0;
    const drain = w.block[i] === BlockType.Drainage && (!pumpsNeedPower || w.powered[i] > 0) ? drainRate : 0;
    const sink = Math.min(value, soak + drain);
    removed += sink; w.water[i] = value - sink;
  }
  return { before, added, removed, after: totalWater(w) };
}
