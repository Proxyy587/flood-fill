import type { RequestId } from './ids';

export interface InspectorData {
  id: number;
  kind: 'npc' | 'vehicle' | 'building' | 'cell';
  title: string;
  attributes: Record<string, number | string>;
  assignment?: { requestId: RequestId; status: string; eta: number };
  route?: { cells: number[]; version: number };
  belief?: { knownClosures: number[]; staleness: number };
  lastDecision?: {
    tick: number;
    chosen: string;
    alternatives: { label: string; score: number }[];
    reason: string;
  };
}
