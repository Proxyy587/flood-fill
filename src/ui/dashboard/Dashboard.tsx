'use client';

import { useMemo } from 'react';
import type { MetricsFrame, Scenario, SimEvent } from '../../contracts';
import { replayBus } from '../../bridge/buses';
import { Bars, LineChart, type Series } from './charts';
import { districtWaits } from './runStats';
import styles from './report.module.css';

const HOSPITAL_COLORS = ['#1f9d63', '#1e6fd9', '#c98a06', '#8e44ad', '#d93a2b'];
const fmtMin = (s: number) => (s >= 60 ? `${(s / 60).toFixed(1)} min` : `${Math.round(s)} s`);

/** Live charts and response, fairness and safety numbers for the current run. */
export function Dashboard({ metrics, events, scenario, names }: { metrics: readonly MetricsFrame[]; events: readonly SimEvent[]; scenario: Scenario; names: Record<number, string> }) {
  const last = metrics.at(-1);
  const maxX = Math.max(600, last?.tick ?? 0);
  const cells = scenario.size.w * scenario.size.h;
  const series = (pick: (m: MetricsFrame) => number, label: string, color: string): Series[] => [{ label, color, points: metrics.map((m) => [m.tick, pick(m)]) }];
  const marks = useMemo(() => {
    const out: { tick: number; color: string; label: string }[] = [];
    for (const e of events) {
      if (e.type === 'POWER_TRIP') out.push({ tick: e.tick, color: '#d93a2b', label: e.reason });
      if (e.type === 'HOSPITAL_DIVERSION_ON') out.push({ tick: e.tick, color: '#c98a06', label: e.reason });
      if (e.type === 'INJECTED') out.push({ tick: e.tick, color: '#1e6fd9', label: e.reason });
    }
    return out;
  }, [events]);
  const hospitals = useMemo(() => {
    const ids = [...new Set(metrics.flatMap((m) => m.hospitals.map((h) => h.id)))];
    return ids.map((id, i) => ({
      label: names[id] ?? `Hospital #${id}`,
      color: HOSPITAL_COLORS[i % HOSPITAL_COLORS.length],
      points: metrics.map((m) => [m.tick, (m.hospitals.find((h) => h.id === id)?.util ?? 0) * 100] as [number, number]),
    }));
  }, [metrics, names]);
  const fairness = useMemo(() => districtWaits({ events: events as SimEvent[] }, scenario), [events, scenario]);
  const generators = events.filter((e) => e.type === 'GENERATOR_START' || e.type === 'GENERATOR_FUEL_LOW' || e.type === 'GENERATOR_EXHAUSTED');

  if (!last) return <p className={styles.muted}>Start the storm to see the charts fill in. Numbers update every 10 simulated seconds.</p>;
  const pick = (tick: number) => replayBus.seek(tick);

  return (
    <>
      <section className={styles.section}>
        <h3 className={styles.heading}>
          The storm <span>click a chart to jump the replay</span>
        </h3>
        <div className={styles.charts}>
          <LineChart title="Flooded area" value={`${((last.floodedCells / cells) * 100).toFixed(1)}%`} series={series((m) => (m.floodedCells / cells) * 100, 'Flooded', '#1e6fd9')} maxX={maxX} markers={marks} onPick={pick} />
          <LineChart title="Without power" value={`${Math.round(last.unpoweredPopPct)}%`} series={series((m) => m.unpoweredPopPct, 'Unpowered', '#d93a2b')} maxX={maxX} maxY={100} markers={marks} onPick={pick} />
          <LineChart title="Evacuated" value={`${Math.round(last.evacDonePct)}%`} series={series((m) => m.evacDonePct, 'Evacuated', '#1f9d63')} maxX={maxX} maxY={100} onPick={pick} />
          <LineChart title="Stranded" value={String(last.stranded)} series={series((m) => m.stranded, 'Stranded', '#c98a06')} maxX={maxX} onPick={pick} />
          <LineChart title="Gridlocked cells" value={String(last.gridlockCells)} series={series((m) => m.gridlockCells, 'Gridlock', '#8e44ad')} maxX={maxX} onPick={pick} />
          <LineChart title="Rooftop rescues" value={String(last.heliRescues)} series={series((m) => m.heliRescues, 'Rescues', '#15232d')} maxX={maxX} onPick={pick} />
          {hospitals.length > 0 && (
            <LineChart wide title="Hospital beds in use" value={`peak ${Math.round(Math.max(...hospitals.flatMap((h) => h.points.map((p) => p[1]))))}%`} series={hospitals} maxX={maxX} maxY={100} markers={marks.filter((m) => m.color === '#c98a06')} onPick={pick} />
          )}
        </div>
        {generators.length > 0 && (
          <p className={styles.muted}>
            Backup power: {generators.slice(-3).map((g) => g.reason).join(' · ')}
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Response</h3>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <strong>{fmtMin(last.tts.mean)}</strong>
            <span>mean wait</span>
          </div>
          <div className={styles.stat}>
            <strong>{fmtMin(last.tts.p50)}</strong>
            <span>median</span>
          </div>
          <div className={styles.stat}>
            <strong>{fmtMin(last.tts.p90)}</strong>
            <span>slowest 10%</span>
          </div>
          <div className={styles.stat} data-bad={last.unmet > 0}>
            <strong>{last.unmet}</strong>
            <span>unanswered</span>
          </div>
        </div>
        <Bars rows={Object.entries(last.idleFrac).map(([k, v]) => ({ label: `${k.charAt(0).toUpperCase()}${k.slice(1)}s idle`, value: v, display: `${Math.round(v * 100)}%`, color: '#5e6e78' }))} max={1} />
        <div className={styles.stats}>
          <div className={styles.stat} data-bad={last.routeViolations > 0} title="Vehicles entering water deeper than their limit. Must be zero.">
            <strong>{last.routeViolations}</strong>
            <span>route violations</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>
          Fairness <span>Gini {last.gini.toFixed(2)} · 0 means everyone waited equally</span>
        </h3>
        {fairness.length ? (
          <Bars rows={fairness.map((d) => ({ label: d.name, value: d.mean, display: `${fmtMin(d.mean)}${d.unmet ? ` · ${d.unmet} open` : ''}`, color: d.unmet ? '#d93a2b' : '#1e6fd9' }))} />
        ) : (
          <p className={styles.muted}>No rescue requests yet.</p>
        )}
      </section>
    </>
  );
}
