import { describe, expect, it } from 'vitest';
import { asNpcId, asRequestId, asVehicleId, type SimEvent } from '../../contracts';
import { mockRunSummary } from '../../contracts/mocks';
import { topIncidents } from './afterAction';
import { assignmentLog, buildDecisionChain, requestLifecycle } from './decisionChain';

const v = (id: number) => ({ actor: asVehicleId(id), actorKind: 'vehicle' as const });
const r = (id: number) => ({ target: asRequestId(id), targetKind: 'request' as const });

const log: SimEvent[] = [
  { tick: 10, type: 'REQUEST_CREATED', reason: 'rescue request for civilian #5', actor: asNpcId(5), actorKind: 'npc', ...r(1), cell: 40 },
  { tick: 12, type: 'BID', reason: 'Boat #2 bids ETA 50', ...v(2), ...r(1) },
  { tick: 12, type: 'BID', reason: 'Boat #3 bids ETA 70', ...v(3), ...r(1) },
  { tick: 12, type: 'ASSIGNED', reason: 'Boat #2 won contract-net auction, ETA 50; next best Boat #3 ETA 70', ...v(2), ...r(1) },
  { tick: 20, type: 'ROAD_CLOSED', reason: 'cell (3,4) depth 0.4 > 0.3', cell: 99 },
  { tick: 25, type: 'REROUTE', reason: 'path blocked at (3,4)', ...v(2), cell: 99 },
  { tick: 30, type: 'COMMIT_CANCELLED', reason: 'Boat #2 ETA now 140 > threshold', ...v(2), ...r(1) },
  { tick: 31, type: 'ASSIGNED', reason: 'Boat #3 won re-auction, ETA 40', ...v(3), ...r(1) },
  { tick: 70, type: 'SERVED', reason: 'request #1 served by Boat #3 in 60 ticks', ...v(3), ...r(1), data: { tts: 60 } },
];

describe('decision chain', () => {
  it('explains a reroute: assignment, rivals, closure cause, cancellation', () => {
    const chain = buildDecisionChain(log, { kind: 'vehicle', id: 2 });
    expect(chain.map((s) => s.kind)).toEqual(['assigned', 'competing', 'reroute', 'cancelled']);
    expect(chain[1].because).toContain('Boat #3 bids ETA 70');
    expect(chain[2].because).toBe('cell (3,4) depth 0.4 > 0.3 (closed at tick 20)');
    expect(chain[3].request).toBe(1);
  });
  it('follows the unit that took over to service', () => {
    expect(buildDecisionChain(log, { kind: 'vehicle', id: 3 }).map((s) => s.kind)).toEqual(['assigned', 'competing', 'served']);
  });
  it('ignores other kinds with the same numeric id', () => {
    expect(buildDecisionChain(log, { kind: 'npc', id: 2 })).toEqual([]);
  });
});

describe('request lifecycle and assignment log', () => {
  it('orders created → bids → assigned → cancelled → assigned → served', () => {
    expect(requestLifecycle(log, 1).map((s) => s.stage)).toEqual(['created', 'bids', 'assigned', 'cancelled', 'assigned', 'served']);
  });
  it('records how each assignment ended', () => {
    const rows = assignmentLog(log);
    expect(rows.map((x) => [x.unit, x.outcome, x.took])).toEqual([
      [2, 'cancelled', 18],
      [3, 'served', 39],
    ]);
  });
});

describe('after-action top incidents', () => {
  it('ranks power trips above routine events and folds repeats', () => {
    const top = topIncidents(mockRunSummary(1800, 7).events);
    expect(top.length).toBeLessThanOrEqual(5);
    expect(top[0].type).toBe('POWER_TRIP');
    expect(top.some((i) => i.type === 'ROOFTOP_RESCUE' && i.detail.includes('more like it'))).toBe(true);
  });
});
