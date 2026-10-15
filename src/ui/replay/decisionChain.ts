import type { EntityRef, SimEvent, SimEventType } from '../../contracts';

export type StepKind = 'assigned' | 'competing' | 'cancelled' | 'reroute' | 'served' | 'hospital' | 'air' | 'stalled';

export interface DecisionStep {
  tick: number;
  kind: StepKind;
  text: string;
  /** Why it happened, when the log says (cause of a reroute, next-best bidder, …). */
  because?: string;
  request?: number;
  cell?: number;
  event: SimEvent;
}

const KIND: Partial<Record<SimEventType, StepKind>> = {
  ASSIGNED: 'assigned',
  COMMIT_CANCELLED: 'cancelled',
  REROUTE: 'reroute',
  SERVED: 'served',
  HOSPITAL_ASSIGN: 'hospital',
  HOSPITAL_DIVERT: 'hospital',
  HELI_DISPATCH: 'air',
  HELI_PICKUP: 'air',
  HELI_DROPOFF: 'air',
  HELI_GROUNDED_WIND: 'air',
  VEHICLE_STALLED: 'stalled',
};

const isActor = (e: SimEvent, ref: EntityRef) => e.actor === ref.id && (e.actorKind === undefined || e.actorKind === ref.kind);

/**
 * "Why was this unit rerouted?": assignment → competing bids → cancellation → reroute cause → new assignment → served,
 * reconstructed from the event log alone.
 */
export function buildDecisionChain(events: readonly SimEvent[], ref: EntityRef): DecisionStep[] {
  const steps: DecisionStep[] = [];
  const closures = new Map<number, SimEvent>();
  for (const e of events) {
    if ((e.type === 'ROAD_CLOSED' || e.type === 'BRIDGE_OVERTOPPED') && e.cell !== undefined) closures.set(e.cell, e);
    if (!isActor(e, ref)) continue;
    const kind = KIND[e.type];
    if (!kind) continue;
    const step: DecisionStep = { tick: e.tick, kind, text: e.reason, cell: e.cell, event: e };
    if (e.targetKind === 'request' && e.target !== undefined) step.request = e.target;
    if (kind === 'reroute' && e.cell !== undefined) {
      const closed = closures.get(e.cell);
      if (closed && closed.tick <= e.tick) step.because = `${closed.reason} (closed at tick ${closed.tick})`;
    }
    if (kind === 'assigned' && step.request !== undefined) {
      const rivals = events.filter((b) => b.type === 'BID' && b.target === step.request && b.tick <= e.tick && b.tick >= e.tick - 30 && !isActor(b, ref));
      if (rivals.length) {
        steps.push(step);
        steps.push({ tick: e.tick, kind: 'competing', text: `${rivals.length} other unit${rivals.length === 1 ? '' : 's'} bid for request #${step.request}`, because: rivals.slice(0, 3).map((b) => b.reason).join('; '), request: step.request, event: rivals[0] });
        continue;
      }
    }
    if (kind === 'cancelled' && step.request === undefined && e.target !== undefined) step.request = e.target;
    steps.push(step);
  }
  return steps;
}

export interface LifecycleStage {
  stage: 'created' | 'bids' | 'assigned' | 'cancelled' | 'served';
  tick: number;
  text: string;
}

/** created → bids → assigned (→ cancelled → re-assigned) → served, for one request. */
export function requestLifecycle(events: readonly SimEvent[], request: number): LifecycleStage[] {
  const out: LifecycleStage[] = [];
  let bids = 0;
  let firstBid = -1;
  for (const e of events) {
    const about = e.target === request && (e.targetKind === 'request' || e.targetKind === undefined);
    if (!about) continue;
    if (e.type === 'REQUEST_CREATED') out.push({ stage: 'created', tick: e.tick, text: e.reason });
    else if (e.type === 'BID') {
      bids++;
      if (firstBid < 0) firstBid = e.tick;
    } else if (e.type === 'ASSIGNED') {
      if (bids) out.push({ stage: 'bids', tick: firstBid, text: `${bids} bid${bids === 1 ? '' : 's'} received` });
      bids = 0;
      firstBid = -1;
      out.push({ stage: 'assigned', tick: e.tick, text: e.reason });
    } else if (e.type === 'COMMIT_CANCELLED') out.push({ stage: 'cancelled', tick: e.tick, text: e.reason });
    else if (e.type === 'SERVED') out.push({ stage: 'served', tick: e.tick, text: e.reason });
  }
  if (bids) out.push({ stage: 'bids', tick: firstBid, text: `${bids} bid${bids === 1 ? '' : 's'} received, none assigned yet` });
  return out.sort((a, b) => a.tick - b.tick);
}

export interface AssignmentRow {
  tick: number;
  request: number;
  unit: number;
  unitKind: string;
  outcome: 'served' | 'cancelled' | 'open';
  reason: string;
  /** Seconds from assignment to service or cancellation. */
  took: number | null;
}

/** One row per assignment, with how it ended. */
export function assignmentLog(events: readonly SimEvent[]): AssignmentRow[] {
  const rows: AssignmentRow[] = [];
  const open = new Map<string, AssignmentRow>();
  for (const e of events) {
    if (e.target === undefined || e.actor === undefined) continue;
    const key = `${e.target}:${e.actorKind ?? ''}:${e.actor}`;
    if (e.type === 'ASSIGNED') {
      const row: AssignmentRow = { tick: e.tick, request: e.target, unit: e.actor, unitKind: e.reason.split(' #')[0] || 'Unit', outcome: 'open', reason: e.reason, took: null };
      rows.push(row);
      open.set(key, row);
    } else if (e.type === 'SERVED' || e.type === 'COMMIT_CANCELLED') {
      const row = open.get(key);
      if (!row) continue;
      row.outcome = e.type === 'SERVED' ? 'served' : 'cancelled';
      row.took = e.tick - row.tick;
      if (e.type === 'COMMIT_CANCELLED') row.reason = e.reason;
      open.delete(key);
    }
  }
  return rows;
}
