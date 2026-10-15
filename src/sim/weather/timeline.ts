/** Piecewise-linear weather, clamped to first/last sample outside its interval. */
export function sampleTimeline(points: readonly { t: number; value: number }[], tick: number): number {
  if (!Number.isFinite(tick) || tick < 0 || points.length === 0) throw new RangeError("Invalid weather query");
  for (let i = 0; i < points.length; i++) {
    if (!Number.isFinite(points[i].t) || points[i].t < 0 || !Number.isFinite(points[i].value) || (i > 0 && points[i].t <= points[i - 1].t)) throw new RangeError("Weather timeline must be finite and strictly increasing");
  }
  if (tick <= points[0].t) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    if (tick <= points[i].t) {
      const a = points[i - 1]; const b = points[i];
      return a.value + (b.value - a.value) * ((tick - a.t) / (b.t - a.t));
    }
  }
  return points[points.length - 1].value;
}
