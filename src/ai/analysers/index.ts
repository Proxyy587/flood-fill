import type { RunSummary } from '../../contracts';
import type { CityIndex } from '../cityIndex';
import type { Analysis } from './common';
import { drainageCoverage, hospitalImbalance, isolatedRooftops, powerCascade } from './hazards';
import { gridlockHotspots, isolatedZones, responseGaps } from './network';

export type { Analysis, AnalyserKind } from './common';
export { gridlockHotspots, isolatedZones, responseGaps, drainageCoverage, hospitalImbalance, isolatedRooftops, powerCascade };

/** Every analyser over one run, most severe first. Pure and deterministic. */
export function analyseRun(run: RunSummary, city: CityIndex): Analysis[] {
  return [gridlockHotspots, isolatedZones, isolatedRooftops, hospitalImbalance, powerCascade, drainageCoverage, responseGaps]
    .map((a) => a(run, city))
    .filter((a) => a.findings.length > 0)
    .sort((a, b) => b.score - a.score);
}
