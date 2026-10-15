import type { MetricsFrame, RunSummary, SimEvent, SimEventType } from '../../contracts';
import type { CityIndex } from '../cityIndex';
import type { Finding, Severity } from '../schema';

export type AnalyserKind = 'gridlock' | 'isolated_zones' | 'isolated_rooftops' | 'hospital_imbalance' | 'power_cascade' | 'drainage' | 'response_gaps';

export interface Analysis {
  kind: AnalyserKind;
  findings: Finding[];
  /** Cells worth highlighting on the map. */
  cells: number[];
  /** 0 (fine) … 1 (severe). */
  score: number;
  evidenceTicks: number[];
}

export type Analyser = (run: RunSummary, city: CityIndex) => Analysis;

export const MAX_CELLS = 40;
export const MAX_TICKS = 10;

export const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
export const severityOf = (score: number): Severity => (score >= 0.6 ? 'high' : score >= 0.3 ? 'medium' : 'low');
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const minutes = (ticks: number) => `${Math.round(ticks / 60)} min`;

export const ofType = (run: RunSummary, ...types: SimEventType[]): SimEvent[] => {
  const set = new Set(types);
  return run.events.filter((e) => set.has(e.type));
};

export const ticksOf = (events: readonly SimEvent[], max = MAX_TICKS): number[] => [...new Set(events.map((e) => e.tick))].sort((a, b) => a - b).slice(0, max);

export const cellsOf = (events: readonly SimEvent[]): number[] => [...new Set(events.flatMap((e) => (e.cell === undefined ? [] : [e.cell])))];

/** Seconds between metric frames (frames are sampled, not per tick). */
export const frameInterval = (metrics: readonly MetricsFrame[]): number => (metrics.length > 1 ? Math.max(1, metrics[1].tick - metrics[0].tick) : 1);

/** Counts per district name, most first. */
export function byDistrict(cells: readonly number[], city: CityIndex): { name: string; cells: number[] }[] {
  const groups = new Map<string, number[]>();
  for (const c of cells) {
    const name = city.districtName(c);
    const list = groups.get(name) ?? [];
    list.push(c);
    groups.set(name, list);
  }
  return [...groups.entries()].map(([name, list]) => ({ name, cells: list })).sort((a, b) => b.cells.length - a.cells.length);
}

export const empty = (kind: AnalyserKind): Analysis => ({ kind, findings: [], cells: [], score: 0, evidenceTicks: [] });
