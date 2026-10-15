import { BlockType } from '../../contracts';
import type { CityIndex } from '../cityIndex';
import { byDistrict, cellsOf, clamp01, empty, frameInterval, MAX_CELLS, minutes, ofType, pct, severityOf, ticksOf, type Analyser } from './common';

/** Where traffic stopped: gridlock and stalled-vehicle events, plus time with any gridlocked cell. */
export const gridlockHotspots: Analyser = (run, city) => {
  const events = ofType(run, 'GRIDLOCK', 'VEHICLE_STALLED');
  const dt = frameInterval(run.metrics);
  const lockedTicks = run.metrics.filter((m) => m.gridlockCells > 0).length * dt;
  const peak = run.metrics.reduce((m, f) => Math.max(m, f.gridlockCells), 0);
  const cells = [...cellsOf(events), ...run.hotspots.filter((h) => h.kind === 'gridlock').flatMap((h) => h.cells)];
  if (!events.length && !lockedTicks) return empty('gridlock');
  const score = clamp01(events.length / 40 + lockedTicks / 1800);
  const groups = byDistrict(cells, city).slice(0, 2);
  const stalled = events.filter((e) => e.type === 'VEHICLE_STALLED').length;
  const findings = groups.map((g, i) => ({
    id: `gridlock-${i + 1}`,
    severity: severityOf(score),
    title: lockedTicks ? `Traffic stopped in ${g.name}` : `Vehicles stalled in water in ${g.name}`,
    explanation:
      `${g.cells.length} stalled or gridlocked road cells in ${g.name}, first at ${city.describe(g.cells[0])}. ` +
      `Across the city ${stalled} vehicles stalled in water` +
      (lockedTicks ? ` and some road was gridlocked for ${minutes(lockedTicks)} (peak ${peak} cells).` : '; no road reached full gridlock.'),
    evidence: [{ cells: g.cells.slice(0, MAX_CELLS), eventTicks: ticksOf(events.filter((e) => e.cell !== undefined && g.cells.includes(e.cell))) }, { metric: 'gridlockMinutes', value: Math.round(lockedTicks / 60) }],
    confidence: events.length >= 5 ? ('medium' as const) : ('low' as const),
  }));
  return { kind: 'gridlock', findings, cells: cells.slice(0, MAX_CELLS * 2), score, evidenceTicks: ticksOf(events) };
};

/** Road cells cut off from every hospital and shelter at the moment the most roads were closed. */
export const isolatedZones: Analyser = (run, city) => {
  const { w, h } = city;
  const closed = new Set<number>();
  let worst = new Set<number>();
  let worstTick = 0;
  for (const e of run.events) {
    if (e.cell === undefined) continue;
    if (e.type === 'ROAD_CLOSED' || e.type === 'BRIDGE_OVERTOPPED') closed.add(e.cell);
    else if (e.type === 'ROAD_REOPENED') closed.delete(e.cell);
    else continue;
    if (closed.size > worst.size) {
      worst = new Set(closed);
      worstTick = e.tick;
    }
  }
  if (!worst.size) return empty('isolated_zones');
  const reachable = reachableRoads(city, worst);
  const isolated: number[] = [];
  let roads = 0;
  for (let c = 0; c < w * h; c++) {
    if (!city.isRoad(c) || worst.has(c)) continue;
    roads++;
    if (!reachable.has(c)) isolated.push(c);
  }
  if (!isolated.length || !roads) return empty('isolated_zones');
  const share = isolated.length / roads;
  const totals = new Map<string, number>();
  for (let c = 0; c < w * h; c++) if (city.isRoad(c)) totals.set(city.districtName(c), (totals.get(city.districtName(c)) ?? 0) + 1);
  const groups = byDistrict(isolated, city).filter((g) => g.cells.length / (totals.get(g.name) ?? 1) >= 0.2).slice(0, 3);
  const score = clamp01(share * 2.5);
  const findings = groups.map((g, i) => ({
    id: `isolated-${i + 1}`,
    severity: severityOf(clamp01((g.cells.length / (totals.get(g.name) ?? 1)) * 1.5)),
    title: `${g.name} was cut off from every hospital and shelter`,
    explanation:
      `At the worst moment ${worst.size} road cells were closed. ${g.cells.length} of ${totals.get(g.name)} open road cells in ${g.name} ` +
      `(${pct(g.cells.length / (totals.get(g.name) ?? 1))}) had no open route to any hospital or shelter, around ${city.describe(g.cells[0])}.`,
    evidence: [{ cells: g.cells.slice(0, MAX_CELLS), eventTicks: [worstTick] }, { metric: 'closedRoadCells', value: worst.size }],
    confidence: 'medium' as const,
  }));
  return { kind: 'isolated_zones', findings, cells: isolated.slice(0, MAX_CELLS * 2), score, evidenceTicks: [worstTick] };
};

function reachableRoads(city: CityIndex, closed: Set<number>): Set<number> {
  const { scenario, w, h } = city;
  const seen = new Set<number>();
  const queue: number[] = [];
  const open = (c: number) => city.isRoad(c) && !closed.has(c);
  const push = (c: number) => {
    if (c < 0 || c >= w * h || seen.has(c) || !open(c)) return;
    seen.add(c);
    queue.push(c);
  };
  const neighbours = (c: number) => {
    const x = c % w;
    return [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, c - w, c + w].filter((n) => n >= 0 && n < w * h);
  };
  for (const b of scenario.buildings) {
    if (b.type !== BlockType.Hospital && b.type !== BlockType.Shelter) continue;
    for (const cell of b.cells) for (const n of neighbours(cell)) push(n);
    push(b.entrance);
  }
  for (let i = 0; i < queue.length; i++) for (const n of neighbours(queue[i])) push(n);
  return seen;
}

/** Districts whose requests waited longest or went unserved; the Gini of time to service. */
export const responseGaps: Analyser = (run, city) => {
  const created = new Map<number, { tick: number; cell?: number }>();
  for (const e of ofType(run, 'REQUEST_CREATED')) if (e.target !== undefined) created.set(e.target, { tick: e.tick, cell: e.cell });
  if (!created.size) return empty('response_gaps');
  const served = new Map<number, number>();
  for (const e of ofType(run, 'SERVED')) {
    if (e.target === undefined) continue;
    const start = created.get(e.target);
    const tts = typeof e.data?.tts === 'number' ? e.data.tts : start ? e.tick - start.tick : 0;
    served.set(e.target, tts);
  }
  const perDistrict = new Map<string, { tts: number[]; unmet: number; cells: number[] }>();
  for (const [id, req] of created) {
    const name = req.cell === undefined ? 'unknown place' : city.districtName(req.cell);
    const row = perDistrict.get(name) ?? { tts: [], unmet: 0, cells: [] };
    const t = served.get(id);
    if (t === undefined) row.unmet++;
    else row.tts.push(t);
    if (req.cell !== undefined) row.cells.push(req.cell);
    perDistrict.set(name, row);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const cityMean = mean([...served.values()]);
  const rows = [...perDistrict.entries()]
    .map(([name, r]) => ({ name, mean: mean(r.tts), unmet: r.unmet, total: r.tts.length + r.unmet, cells: r.cells }))
    .sort((a, b) => b.unmet / b.total - a.unmet / a.total || b.mean - a.mean);
  const last = run.metrics.at(-1);
  const gini = last?.gini ?? 0;
  const unmetShare = rows.reduce((s, r) => s + r.unmet, 0) / created.size;
  const score = clamp01(unmetShare + gini);
  const findings = rows
    .filter((r) => r.unmet > 0 || r.mean > cityMean * 1.3)
    .slice(0, 2)
    .map((r, i) => ({
      id: `response-${i + 1}`,
      severity: severityOf(clamp01(r.unmet / r.total + (cityMean ? r.mean / cityMean - 1 : 0) / 2)),
      title: r.unmet ? `${r.unmet} of ${r.total} calls from ${r.name} were still unanswered` : `${r.name} waited longest for help`,
      explanation:
        `Answered requests from ${r.name} waited ${minutes(r.mean)} on average against ${minutes(cityMean)} citywide; ${r.unmet} were still open at minute ${Math.round((run.metrics.at(-1)?.tick ?? 0) / 60)}. ` +
        `Citywide Gini of time to service is ${gini.toFixed(2)} (0 = everyone waited equally).`,
      evidence: [{ cells: r.cells.slice(0, MAX_CELLS) }, { metric: 'gini', value: gini }, { metric: 'unmet', value: r.unmet }],
      confidence: r.total >= 5 ? ('medium' as const) : ('low' as const),
    }));
  return { kind: 'response_gaps', findings, cells: rows.flatMap((r) => r.cells).slice(0, MAX_CELLS * 2), score, evidenceTicks: [] };
};
