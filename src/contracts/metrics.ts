import type { SimEvent } from './events';
import type { BuildingId } from './ids';
import type { DispatchMode } from './scenario';

export interface MetricsFrame {
  tick: number;
  tts: { mean: number; p50: number; p90: number };
  unmet: number;
  idleFrac: Record<string, number>;
  gini: number;
  hospitals: { id: BuildingId; util: number; diversion: boolean; onGenerator: boolean }[];
  evacDonePct: number;
  stranded: number;
  gridlockCells: number;
  floodedCells: number;
  maxDepth: number;
  unpoweredPopPct: number;
  heliRescues: number;
  routeViolations: number;
  /** Homes (houses and apartments) with water above their floor. Optional: not every engine reports it. */
  homesFlooded?: number;
  /** Residents of those homes. */
  residentsAffected?: number;
  /** Share of road cells closed by water or debris, 0..100. */
  roadsClosedPct?: number;
}

export interface RunSummary {
  scenario: string;
  seed: number;
  mode: DispatchMode;
  metrics: MetricsFrame[];
  events: SimEvent[];
  hotspots: {
    kind: 'gridlock' | 'isolated' | 'hospital_overload' | 'power';
    cells: number[];
    score: number;
  }[];
}
