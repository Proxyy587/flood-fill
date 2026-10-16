import type { SimEvent } from '../contracts';

const ACTION_TYPES = new Set<string>([
  'REQUEST_CREATED',
  'BID',
  'ASSIGNED',
  'COMMIT_CANCELLED',
  'REROUTE',
  'SERVED',
  'HOSPITAL_ASSIGN',
  'HOSPITAL_DIVERT',
  'HOSPITAL_DIVERSION_ON',
  'REPORT_CREATED',
  'REPORT_VERIFIED',
  'REPORT_FALSE',
  'EVAC_ORDER',
  'NPC_STRANDED',
  'GRIDLOCK',
  'HELI_DISPATCH',
  'HELI_PICKUP',
  'HELI_DROPOFF',
  'HELI_GROUNDED',
  'HELI_GROUNDED_WIND',
  'ROOFTOP_RESCUE',
  'MEDEVAC',
]);

// These two events are emitted by the simulator's monolithic types, but are missing from the shared barrel union.
const CONTEXTUAL_TYPES = new Set<string>(['ARRIVED', 'NPC_STATE']);
const DECISION_CONTEXT = /ambulance|boat|police|escort|crowd|hospital|rescue|triag|shelter|evacuat|patient|casualty/i;

/** Selects real response decisions and their outcomes; ambient telemetry stays out of the panel. */
export function selectDecisionEvents(events: readonly SimEvent[], limit = 6): SimEvent[] {
  return selectDecisionEntries(events, limit).map(({ event }) => event);
}

export interface DecisionEntry {
  event: SimEvent;
  /** Stable within the append-only run feed, including same-tick decisions by the same unit. */
  key: string;
}

export function selectDecisionEntries(events: readonly SimEvent[], limit = 6): DecisionEntry[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) return [];

  return events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => {
      if (event.data?.mock === true || typeof event.reason !== 'string' || !event.reason.trim()) return false;
      const type = event.type as string;
      return ACTION_TYPES.has(type) || (CONTEXTUAL_TYPES.has(type) && DECISION_CONTEXT.test(event.reason));
    })
    .sort((a, b) => b.event.tick - a.event.tick || b.index - a.index)
    .slice(0, safeLimit)
    .map(({ event, index }) => ({
      event,
      key: JSON.stringify([event.tick, event.type, event.actorKind, event.actor, event.targetKind, event.target, event.cell, index]),
    }));
}
