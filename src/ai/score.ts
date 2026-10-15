import { BlockType, type RunSummary, type Scenario } from '../contracts';

export type ScorePartKey = 'lives' | 'homes' | 'response' | 'mobility' | 'power' | 'care';

export interface ScorePart {
  key: ScorePartKey;
  label: string;
  /** 0..100, higher is better. */
  score: number;
  weight: number;
  /** One plain sentence on what drove this part. */
  detail: string;
}

export interface CityScore {
  /** Weighted 0..100. */
  total: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  verdict: string;
  parts: ScorePart[];
}

/** Jammed road cells that count as real gridlock rather than a queue at one junction. */
const JAM_CELLS = 4;

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const minutes = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const GRADES: { min: number; grade: CityScore['grade']; verdict: string }[] = [
  { min: 85, grade: 'A', verdict: 'Resilient' },
  { min: 70, grade: 'B', verdict: 'Coping' },
  { min: 55, grade: 'C', verdict: 'Strained' },
  { min: 40, grade: 'D', verdict: 'Struggling' },
  { min: 0, grade: 'F', verdict: 'Overwhelmed' },
];

/** Residents the city houses: the denominator for "homes kept dry". */
export const residentsOf = (scenario: Pick<Scenario, 'buildings'>): number =>
  scenario.buildings.reduce((s, b) => s + (b.type === BlockType.House || b.type === BlockType.Apartment ? b.capacity : 0), 0);

/**
 * City resilience score for a run (or the run so far). Every part is a simple,
 * explainable transform of the metrics and event log, so a planner can see
 * which change moved it. Parts an engine does not report are left out and the
 * remaining weights rescale.
 */
export function scoreRun(run: Pick<RunSummary, 'metrics' | 'events'>, scenario: Pick<Scenario, 'population' | 'buildings'>): CityScore {
  const last = run.metrics.at(-1);
  const pop = Math.max(1, scenario.population.count);
  const dt = run.metrics.length > 1 ? run.metrics[1].tick - run.metrics[0].tick : 10;
  const count = (type: string) => run.events.reduce((n, e) => n + (e.type === type ? 1 : 0), 0);
  const parts: ScorePart[] = [];

  const trapped = count('NPC_STRANDED');
  const still = last?.stranded ?? 0;
  const lives = 50 * (1 - clamp01(trapped / (pop * 0.08))) + 50 * (1 - (trapped ? clamp01(still / trapped) : 0));
  parts.push({
    key: 'lives',
    label: 'People kept safe',
    score: lives,
    weight: 30,
    detail: trapped ? `${plural(trapped, 'person', 'people')} trapped by water; ${still} still waiting for rescue.` : 'Nobody was trapped by water.',
  });

  if (last?.residentsAffected !== undefined) {
    const residents = Math.max(1, residentsOf(scenario));
    const share = last.residentsAffected / residents;
    parts.push({
      key: 'homes',
      label: 'Homes kept dry',
      score: 100 * (1 - clamp01(share * 1.5)),
      weight: 20,
      detail: last.homesFlooded ? `${plural(last.homesFlooded, 'home')} flooded above the floor, ${last.residentsAffected} residents (${Math.round(share * 100)}%).` : 'No home took water above its floor.',
    });
  }

  const requests = count('REQUEST_CREATED');
  const p90 = last?.tts.p90 ?? 0;
  const unmetPct = requests ? clamp(((last?.unmet ?? 0) / requests) * 100) : 0;
  const speed = requests ? 100 * clamp01((900 - p90) / (900 - 120)) : 100;
  parts.push({
    key: 'response',
    label: 'Help arrives fast',
    score: 0.6 * speed + 0.4 * (100 - unmetPct),
    weight: 20,
    detail: requests ? `The slowest 10% waited ${minutes(p90)}; ${Math.round(unmetPct)}% of ${plural(requests, 'call')} still unanswered.` : 'No calls for help.',
  });

  const peakClosed = run.metrics.reduce((m, f) => Math.max(m, f.roadsClosedPct ?? 0), 0);
  const gridlockMin = (run.metrics.filter((m) => m.gridlockCells >= JAM_CELLS).length * dt) / 60;
  parts.push({
    key: 'mobility',
    label: 'Roads open',
    score: clamp(100 - peakClosed * 1.2 - Math.min(40, gridlockMin * 1.5)),
    weight: 15,
    detail: `At worst ${Math.round(peakClosed)}% of roads were closed${gridlockMin > 0 ? `; traffic was jammed for ${Math.round(gridlockMin)} min` : ''}.`,
  });

  const unpowered = run.metrics.reduce((m, f) => Math.max(m, f.unpoweredPopPct), 0);
  parts.push({
    key: 'power',
    label: 'Power stays on',
    score: clamp(100 - unpowered * 1.2),
    weight: 10,
    detail: unpowered > 0 ? `At worst ${Math.round(unpowered)}% of residents had no power.` : 'Nobody lost power.',
  });

  const diversionMin = (run.metrics.filter((m) => m.hospitals.some((h) => h.diversion)).length * dt) / 60;
  const exhausted = count('GENERATOR_EXHAUSTED');
  parts.push({
    key: 'care',
    label: 'Hospitals working',
    score: clamp(100 - diversionMin * 4 - exhausted * 20),
    weight: 5,
    detail: diversionMin > 0 ? `A hospital turned patients away for ${Math.round(diversionMin)} min.` : 'Every hospital kept taking patients.',
  });

  const weight = parts.reduce((s, p) => s + p.weight, 0);
  const total = Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0) / weight);
  for (const p of parts) p.score = Math.round(p.score);
  const g = GRADES.find((x) => total >= x.min) ?? GRADES[GRADES.length - 1];
  return { total, grade: g.grade, verdict: g.verdict, parts };
}

/** The two weakest parts, for the critic's goal and the score card. */
export const weakestParts = (s: CityScore, n = 2): ScorePart[] => [...s.parts].sort((a, b) => a.score - b.score || b.weight - a.weight).slice(0, n);
