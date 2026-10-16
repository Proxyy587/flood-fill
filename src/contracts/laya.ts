import type { DispatchMode } from './scenario';

/** Browser model choices frozen before the first simulation tick. */
export interface LayaDecisionTape {
  version: 1;
  modelRevision: string;
  scenarioFingerprint: string;
  seed: number;
  dispatchMode: DispatchMode;
  hospitalPreference: Partial<Record<'minor' | 'moderate' | 'severe', number>>;
}
