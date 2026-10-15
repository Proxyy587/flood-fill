import { BlockType } from '../../contracts';
import { byDistrict, cellsOf, clamp01, empty, frameInterval, MAX_CELLS, minutes, ofType, pct, severityOf, ticksOf, type Analyser } from './common';

/** People stranded (often on rooftops) whose rescue request was never served. */
export const isolatedRooftops: Analyser = (run, city) => {
  const stranded = ofType(run, 'NPC_STRANDED');
  if (!stranded.length) return empty('isolated_rooftops');
  const requestOf = new Map<number, number>();
  for (const e of ofType(run, 'REQUEST_CREATED')) if (e.actor !== undefined && e.target !== undefined) requestOf.set(e.actor, e.target);
  const served = new Set<number>(ofType(run, 'SERVED').flatMap((e) => (e.target === undefined ? [] : [e.target])));
  const lifted = new Set<number>(ofType(run, 'ROOFTOP_RESCUE', 'HELI_PICKUP').flatMap((e) => (e.target === undefined ? [] : [e.target])));
  const left = stranded.filter((e) => {
    if (e.actor === undefined) return true;
    const req = requestOf.get(e.actor);
    return !lifted.has(e.actor) && (req === undefined || !served.has(req));
  });
  const finalStranded = run.metrics.at(-1)?.stranded ?? left.length;
  const score = clamp01(left.length / stranded.length);
  const cells = cellsOf(left);
  const groups = byDistrict(cells, city).slice(0, 2);
  const rescues = run.metrics.at(-1)?.heliRescues ?? 0;
  const findings = groups.map((g, i) => ({
    id: `rooftops-${i + 1}`,
    severity: severityOf(score),
    title: `${g.cells.length} people still stranded in ${g.name}`,
    explanation:
      `${stranded.length} people were stranded during the storm and ${left.length} were never reached (${finalStranded} at the end). ` +
      `In ${g.name} they were around ${city.describe(g.cells[0])}. Helicopters made ${rescues} rooftop rescues in total.`,
    evidence: [{ cells: g.cells.slice(0, MAX_CELLS), eventTicks: ticksOf(left.filter((e) => e.cell !== undefined && g.cells.includes(e.cell))) }, { metric: 'stranded', value: finalStranded }],
    confidence: 'medium' as const,
  }));
  return { kind: 'isolated_rooftops', findings, cells: cells.slice(0, MAX_CELLS * 2), score, evidenceTicks: ticksOf(left) };
};

/** One hospital overloaded while another sat empty; time on diversion. */
export const hospitalImbalance: Analyser = (run, city) => {
  const frames = run.metrics.filter((m) => m.hospitals.length > 0);
  if (!frames.length) return empty('hospital_imbalance');
  const dt = frameInterval(run.metrics);
  const peak = new Map<number, number>();
  const diverted = new Map<number, number>();
  let widest = { spread: 0, tick: 0 };
  for (const f of frames) {
    const utils = f.hospitals.map((x) => x.util);
    const spread = Math.max(...utils) - Math.min(...utils);
    if (spread > widest.spread) widest = { spread, tick: f.tick };
    for (const x of f.hospitals) {
      peak.set(x.id, Math.max(peak.get(x.id) ?? 0, x.util));
      if (x.diversion) diverted.set(x.id, (diverted.get(x.id) ?? 0) + dt);
    }
  }
  const ranked = [...peak.entries()].sort((a, b) => b[1] - a[1]);
  const [busiest, quietest] = [ranked[0], ranked.at(-1)];
  const diverts = ofType(run, 'HOSPITAL_DIVERT', 'HOSPITAL_DIVERSION_ON');
  const score = clamp01(Math.max(0, busiest[1] - 0.75) * 2 + (ranked.length > 1 ? widest.spread / 2 : 0) + diverts.length / 20);
  if (score < 0.1) return empty('hospital_imbalance');
  const footprint = (id: number) => city.scenario.buildings.find((b) => b.id === id)?.cells ?? [];
  const name = (id: number) => city.names.get(id) ?? `Hospital #${id}`;
  const divertedTicks = [...diverted.values()].reduce((a, b) => a + b, 0);
  const findings = [
    {
      id: 'hospitals-1',
      severity: severityOf(score),
      title: ranked.length > 1 ? `${name(busiest[0])} took the load while ${name(quietest?.[0] ?? busiest[0])} stayed quiet` : `${name(busiest[0])} ran near capacity`,
      explanation:
        `${name(busiest[0])} peaked at ${pct(busiest[1])} of beds` +
        (ranked.length > 1 ? `, ${name(quietest?.[0] ?? busiest[0])} at ${pct(quietest?.[1] ?? 0)}; the widest gap was ${pct(widest.spread)}.` : '.') +
        ` Hospitals spent ${minutes(divertedTicks)} on diversion and ${diverts.length} patients were redirected.`,
      evidence: [{ cells: footprint(busiest[0]).slice(0, MAX_CELLS), eventTicks: [widest.tick, ...ticksOf(diverts, 6)] }, { metric: 'peakUtil', value: Math.round(busiest[1] * 100) / 100 }],
      confidence: frames.length > 20 ? ('high' as const) : ('medium' as const),
    },
  ];
  return { kind: 'hospital_imbalance', findings, cells: ranked.flatMap(([id]) => footprint(id)), score, evidenceTicks: [widest.tick] };
};

/** Which substation trips cut power to how much of the city, and how hospitals' generators held. */
export const powerCascade: Analyser = (run, city) => {
  const trips = ofType(run, 'POWER_TRIP');
  const gens = ofType(run, 'GENERATOR_FUEL_LOW', 'GENERATOR_EXHAUSTED');
  const peak = run.metrics.reduce((m, f) => Math.max(m, f.unpoweredPopPct), 0);
  if (!trips.length && !gens.length) return empty('power_cascade');
  const exhausted = gens.filter((e) => e.type === 'GENERATOR_EXHAUSTED').length;
  const score = clamp01(peak / 60 + exhausted * 0.3);
  const footprint = (id: number | undefined) => city.scenario.buildings.find((b) => b.id === id)?.cells ?? [];
  const blackout = new Map(ofType(run, 'BLACKOUT_ZONE').map((e) => [e.actor, typeof e.data?.cells === 'number' ? e.data.cells : 0]));
  const findings = trips.slice(0, 3).map((t, i) => {
    const name = t.actor !== undefined ? (city.names.get(t.actor) ?? `Substation #${t.actor}`) : 'A substation';
    const cut = blackout.get(t.actor) ?? 0;
    return {
      id: `power-${i + 1}`,
      severity: severityOf(clamp01(peak / 60 + (cut > city.w * city.h * 0.25 ? 0.3 : 0))),
      title: `${name} flooded and tripped`,
      explanation:
        `${t.reason}. ${cut ? `${cut} cells (${pct(cut / (city.w * city.h))} of the map) lost grid power. ` : ''}` +
        `At worst ${Math.round(peak)}% of residents were without power` + (exhausted ? `; ${exhausted} backup generator${exhausted === 1 ? '' : 's'} ran dry.` : '.'),
      evidence: [{ cells: footprint(t.actor).slice(0, MAX_CELLS), eventTicks: [t.tick] }, { metric: 'unpoweredPopPct', value: Math.round(peak) }],
      confidence: 'high' as const,
    };
  });
  return { kind: 'power_cascade', findings, cells: trips.flatMap((t) => footprint(t.actor)), score, evidenceTicks: ticksOf([...trips, ...gens]) };
};

export const DRAIN_RADIUS = 6;

/** Where water pooled with no storm drain nearby. */
export const drainageCoverage: Analyser = (run, city) => {
  const { scenario, w, h } = city;
  const ponds = ofType(run, 'LOCAL_FLOOD', 'FLOOD_THRESHOLD').filter((e) => e.cell !== undefined);
  const flooded = [...new Set([...cellsOf(ponds), ...run.hotspots.filter((x) => x.kind === 'isolated').flatMap((x) => x.cells)])];
  if (!flooded.length) return empty('drainage');
  const drains: number[] = [];
  for (let c = 0; c < scenario.blocks.length; c++) if (scenario.blocks[c] === BlockType.Drainage) drains.push(c);
  const covered = (cell: number) => {
    const x = cell % w;
    const z = Math.floor(cell / w);
    return drains.some((d) => Math.max(Math.abs((d % w) - x), Math.abs(Math.floor(d / w) - z)) <= DRAIN_RADIUS);
  };
  const uncovered = flooded.filter((c) => c >= 0 && c < w * h && !covered(c));
  if (!uncovered.length) return empty('drainage');
  const score = clamp01(uncovered.length / flooded.length);
  const groups = byDistrict(uncovered, city).slice(0, 2);
  const findings = groups.map((g, i) => ({
    id: `drainage-${i + 1}`,
    severity: severityOf(score),
    title: `Water pooled in ${g.name} with no drain within ${DRAIN_RADIUS * 4} m`,
    explanation:
      `${g.cells.length} ponding sites in ${g.name} had no storm drain within ${DRAIN_RADIUS} cells, starting at ${city.describe(g.cells[0])}. ` +
      `The city has ${drains.length} drain cells; ${uncovered.length} of ${flooded.length} ponding sites were uncovered.`,
    evidence: [{ cells: g.cells.slice(0, MAX_CELLS), eventTicks: ticksOf(ponds.filter((e) => e.cell !== undefined && g.cells.includes(e.cell))) }, { metric: 'drainCells', value: drains.length }],
    confidence: ponds.length >= 3 ? ('medium' as const) : ('low' as const),
  }));
  return { kind: 'drainage', findings, cells: uncovered.slice(0, MAX_CELLS * 2), score, evidenceTicks: ticksOf(ponds) };
};
