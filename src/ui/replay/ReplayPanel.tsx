'use client';

import { useMemo, useState } from 'react';
import type { EntityRef, SimEvent } from '../../contracts';
import { replayBus, selectBus } from '../../bridge/buses';
import { topIncidents } from './afterAction';
import { assignmentLog, buildDecisionChain, requestLifecycle, type AssignmentRow } from './decisionChain';
import styles from '../dashboard/report.module.css';

const jump = (e: Pick<SimEvent, 'tick' | 'actor' | 'actorKind' | 'cell'>) => {
  replayBus.seek(e.tick);
  if (e.actor !== undefined && e.actorKind) selectBus.focus({ kind: e.actorKind, id: e.actor });
  selectBus.highlightCells(e.cell === undefined ? [] : [e.cell]);
};

const KIND_LABEL = { assigned: 'Assigned', competing: 'Competing bids', cancelled: 'Cancelled', reroute: 'Rerouted', served: 'Served', hospital: 'Hospital', air: 'Flight', stalled: 'Stalled' } as const;

type SortKey = 'tick' | 'took' | 'unit';

/** After-action top five, the "why" chain for the selected unit, and the assignment log. */
export function ReplayPanel({ events, selected, clock }: { events: readonly SimEvent[]; selected: EntityRef | null; clock: (tick: number) => string }) {
  const incidents = useMemo(() => topIncidents(events), [events]);
  const chain = useMemo(() => (selected ? buildDecisionChain(events, selected) : []), [events, selected]);
  const rows = useMemo(() => assignmentLog(events), [events]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'tick', desc: false });
  const [request, setRequest] = useState<number | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? rows.filter((r) => `${r.reason} #${r.request} ${r.outcome}`.toLowerCase().includes(q)) : rows.slice();
    const val = (r: AssignmentRow) => (sort.key === 'took' ? (r.took ?? Infinity) : sort.key === 'unit' ? r.unit : r.tick);
    return list.sort((a, b) => (val(a) - val(b)) * (sort.desc ? -1 : 1));
  }, [rows, query, sort]);
  const lifecycle = useMemo(() => (request === null ? [] : requestLifecycle(events, request)), [events, request]);
  const head = (key: SortKey, label: string) => (
    <th onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }))} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      {label}
      {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <>
      <section className={styles.section}>
        <h3 className={styles.heading}>
          Top incidents <span>written from fixed templates</span>
        </h3>
        {incidents.length ? (
          incidents.map((i) => (
            <div key={`${i.type}-${i.tick}`} className={styles.card} data-clickable="true" role="button" tabIndex={0} onClick={() => jump(i.event)} onKeyDown={(e) => e.key === 'Enter' && jump(i.event)}>
              <h4>
                {i.title}
                <span className={styles.pill}>{clock(i.tick)}</span>
              </h4>
              <p>{i.detail}</p>
            </div>
          ))
        ) : (
          <p className={styles.muted}>Nothing major has happened yet.</p>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>
          Why did it do that? <span>{selected ? `${selected.kind} #${selected.id}` : 'select a vehicle on the map'}</span>
        </h3>
        {selected && chain.length ? (
          <ol className={styles.chain}>
            {chain.map((s, i) => (
              <li key={i} data-kind={s.kind} onClick={() => jump(s.event)} style={{ cursor: 'pointer' }}>
                <b>{KIND_LABEL[s.kind]}</b> · {clock(s.tick)}
                {s.request !== undefined && (
                  <>
                    {' '}
                    ·{' '}
                    <button type="button" className={styles.pill} data-tone="info" onClick={(e) => (e.stopPropagation(), setRequest(s.request ?? null))}>
                      request #{s.request}
                    </button>
                  </>
                )}
                <small>{s.text}</small>
                {s.because && <small>Because: {s.because}</small>}
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.muted}>{selected ? 'No decisions recorded for this one yet.' : 'Pick an ambulance, boat or helicopter to see each assignment, the rival bids, why it rerouted or gave up, and who took over.'}</p>
        )}
      </section>

      {request !== null && (
        <section className={styles.section}>
          <h3 className={styles.heading}>
            Request #{request}
            <button type="button" className={styles.pill} onClick={() => setRequest(null)}>
              close
            </button>
          </h3>
          <ol className={styles.chain}>
            {lifecycle.map((s, i) => (
              <li key={i} data-kind={s.stage === 'served' ? 'served' : s.stage === 'cancelled' ? 'cancelled' : 'assigned'}>
                <b>{s.stage}</b> · {clock(s.tick)}
                <small>{s.text}</small>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className={styles.section}>
        <h3 className={styles.heading}>
          Assignments <span>{rows.length} total</span>
        </h3>
        <input className={styles.search} placeholder="Search units, requests, reasons" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search assignments" />
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {head('tick', 'Time')}
                {head('unit', 'Unit')}
                <th>Request</th>
                {head('took', 'Took')}
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 200).map((r, i) => (
                <tr
                  key={i}
                  data-clickable="true"
                  title={r.reason}
                  onClick={() => {
                    replayBus.seek(r.tick);
                    selectBus.focus({ kind: 'vehicle', id: r.unit });
                    setRequest(r.request);
                  }}
                >
                  <td>{clock(r.tick)}</td>
                  <td>
                    {r.unitKind} #{r.unit}
                  </td>
                  <td>#{r.request}</td>
                  <td>{r.took === null ? '–' : `${Math.round(r.took / 6) / 10} min`}</td>
                  <td>
                    <span className={styles.pill} data-tone={r.outcome === 'served' ? 'good' : r.outcome === 'cancelled' ? 'bad' : 'warn'}>
                      {r.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
