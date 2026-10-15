'use client';

import styles from './report.module.css';

export interface Series {
  label: string;
  color: string;
  points: [number, number][];
}

const W = 240;
const H = 64;

/** Small multi-line chart. `markers` are ticks drawn as dashed verticals (diversions, trips). */
export function LineChart({ title, value, series, maxX, maxY, markers = [], wide, onPick }: { title: string; value: string; series: Series[]; maxX: number; maxY?: number; markers?: { tick: number; color: string; label: string }[]; wide?: boolean; onPick?: (tick: number) => void }) {
  const top = Math.max(maxY ?? 0, ...series.flatMap((s) => s.points.map((p) => p[1])), 1e-6);
  const X = (t: number) => (Math.min(maxX, t) / Math.max(1, maxX)) * W;
  const Y = (v: number) => H - (v / top) * (H - 4);
  return (
    <div className={`${styles.chart} ${wide ? styles.chartWide : ''}`}>
      <div className={styles.chartTitle}>
        <span>{title}</span>
        <b>{value}</b>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title}: ${value}`}
        onClick={(e) => {
          if (!onPick) return;
          const r = e.currentTarget.getBoundingClientRect();
          onPick(Math.round(((e.clientX - r.left) / r.width) * maxX));
        }}
        style={{ cursor: onPick ? 'pointer' : undefined }}
      >
        <line x1={0} x2={W} y1={H} y2={H} stroke="rgba(21,35,45,0.12)" />
        {markers.map((m, i) => (
          <line key={i} x1={X(m.tick)} x2={X(m.tick)} y1={0} y2={H} stroke={m.color} strokeDasharray="3 3" strokeWidth={1}>
            <title>{m.label}</title>
          </line>
        ))}
        {series.map((s) =>
          s.points.length ? (
            <polyline key={s.label} points={s.points.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ) : null,
        )}
      </svg>
      {series.length > 1 && (
        <div className={styles.legend}>
          {series.map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Bars({ rows, max }: { rows: { label: string; value: number; display: string; color?: string }[]; max?: number }) {
  const top = Math.max(max ?? 0, ...rows.map((r) => r.value), 1e-6);
  return (
    <div className={styles.bars}>
      {rows.map((r) => (
        <div key={r.label} className={styles.bar}>
          <span title={r.label}>{r.label}</span>
          <span className={styles.track}>
            <span className={styles.fill} style={{ width: `${(r.value / top) * 100}%`, background: r.color }} />
          </span>
          <output>{r.display}</output>
        </div>
      ))}
    </div>
  );
}
