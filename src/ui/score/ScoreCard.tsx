'use client';

import { Sparkles, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useSceneStore } from '../../bridge/sceneStore';
import { useSimFeedStore } from '../../bridge/simFeedStore';
import { scoreRun, weakestParts, type CityScore, type ScorePartKey } from '../../ai/score';
import { useEditorStore } from '../store/editorStore';
import { runsOf, useScoreStore, type ScoreEntry } from './scoreStore';
import styles from './score.module.css';

/** Real-world levers that move each part in this model, in plain words. */
export const RAISE_TIPS: Record<ScorePartKey, string> = {
  lives: 'Put shelters and a boat depot near the lowest homes, and add a helipad where streets flood first so helicopters can reach rooftops.',
  homes: 'Plant trees and keep grass uphill so rain soaks in, put storm drains at the low point of each hollow, and close gaps in the levee where the river spills into streets.',
  response: 'Add a second river crossing and keep one road on high ground so rescue teams can reach every district.',
  mobility: 'Lift key roads out of hollows, drain street low points, and give the city a bridge that stays above the river.',
  power: 'Move substations to high ground or ring them with a levee. A blackout also stops drain pumps and traffic lights.',
  care: 'Give each hospital a generator and a dry access road, and spread beds across districts.',
};

const TONE: Record<CityScore['grade'], string> = { A: 'var(--green)', B: '#3f9b4f', C: 'var(--amber)', D: '#d8661f', F: 'var(--danger)' };

/** Score for the run so far, recomputed as metrics arrive. */
export function useLiveScore(): CityScore | null {
  const scenario = useEditorStore((s) => s.scenario);
  const metrics = useSimFeedStore((s) => s.metrics);
  const events = useSimFeedStore((s) => s.events);
  return useMemo(() => (scenario && metrics.length ? scoreRun({ metrics, events }, scenario) : null), [scenario, metrics, events]);
}

/** Records one history entry per finished run. Mount once. */
export function ScoreRecorder() {
  useEffect(
    () =>
      useSimFeedStore.subscribe((s, prev) => {
        if (!s.done || s.done === prev.done) return;
        const scenario = useEditorStore.getState().scenario;
        if (!scenario) return;
        const score = scoreRun(s.done, scenario);
        useScoreStore.getState().record({
          at: Date.now(),
          city: scenario.name,
          seed: s.done.seed,
          engine: useSceneStore.getState().engine,
          minutes: Math.round((s.done.metrics.at(-1)?.tick ?? 0) / 60),
          total: score.total,
          grade: score.grade,
          parts: score.parts.map((p) => ({ key: p.key, score: p.score })),
        });
      }),
    [],
  );
  return null;
}

function Delta({ now, before }: { now: number; before: number | undefined }) {
  if (before === undefined) return null;
  const d = now - before;
  if (d === 0) return <span className={styles.delta}>same as last run</span>;
  return (
    <span className={styles.delta} data-up={d > 0}>
      {d > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {d > 0 ? '+' : ''}
      {d} vs last run
    </span>
  );
}

function Ring({ score, size = 44 }: { score: CityScore; size?: number }) {
  const r = size / 2 - 4;
  const len = 2 * Math.PI * r;
  return (
    <svg className={styles.ring} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--hair)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TONE[score.grade]} strokeWidth={4} strokeLinecap="round" strokeDasharray={`${(score.total / 100) * len} ${len}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.34} fontWeight={750} fill="var(--ink)">
        {score.total}
      </text>
    </svg>
  );
}

/** Compact live score for the vitals panel. */
export function ScoreBadge({ onOpen }: { onOpen?: () => void }) {
  const score = useLiveScore();
  const city = useEditorStore((s) => s.scenario?.name ?? '');
  const history = useScoreStore((s) => s.history);
  const done = useSimFeedStore((s) => s.done);
  if (!score) return null;
  const runs = runsOf(history, city);
  const previous = (done ? runs.slice(0, -1) : runs).at(-1)?.total;
  const weakest = weakestParts(score, 1)[0];
  return (
    <button type="button" className={styles.badge} onClick={onOpen} title="Open the score breakdown">
      <Ring score={score} />
      <span>
        <b>
          City score · {score.grade} {score.verdict}
        </b>
        <small>{done ? 'Final' : 'So far'}{weakest ? `; weakest: ${weakest.label.toLowerCase()}` : ''}</small>
        <Delta now={score.total} before={previous} />
      </span>
    </button>
  );
}

function History({ runs }: { runs: ScoreEntry[] }) {
  const shown = runs.slice(-8);
  return (
    <ol className={styles.history}>
      {shown.map((r, i) => {
        const prev = i > 0 ? shown[i - 1].total : runs.length > shown.length ? runs[runs.length - shown.length - 1].total : undefined;
        return (
          <li key={r.at}>
            <span className={styles.bar}>
              <i style={{ height: `${r.total}%`, background: TONE[r.grade] }} />
            </span>
            <b>{r.total}</b>
            <small>{r.city.includes('·') ? 'variant' : 'original'}</small>
            {prev !== undefined && r.total !== prev && <em data-up={r.total > prev}>{r.total > prev ? `+${r.total - prev}` : r.total - prev}</em>}
          </li>
        );
      })}
    </ol>
  );
}

/** Full score breakdown, history and how to raise it. */
export function ScorePanel({ onAskCritic }: { onAskCritic: () => void }) {
  const score = useLiveScore();
  const city = useEditorStore((s) => s.scenario?.name ?? '');
  const history = useScoreStore((s) => s.history);
  const clear = useScoreStore((s) => s.clear);
  const done = useSimFeedStore((s) => s.done);
  const runs = runsOf(history, city);
  if (!score) {
    return (
      <>
        <p className={styles.lead}>Every storm gives the city a resilience score out of 100. Start the storm to see it; change the city and run again to see if it went up.</p>
        {runs.length > 0 && <History runs={runs} />}
      </>
    );
  }
  const previous = (done ? runs.slice(0, -1) : runs).at(-1)?.total;
  const weakest = weakestParts(score, 2);
  return (
    <div className={styles.panel}>
      <header className={styles.head}>
        <Ring score={score} size={72} />
        <div>
          <h3 style={{ color: TONE[score.grade] }}>
            Grade {score.grade} · {score.verdict}
          </h3>
          <p>{done ? 'Final score for this storm.' : 'Score so far; it settles when the storm ends.'}</p>
          <Delta now={score.total} before={previous} />
        </div>
      </header>

      <ul className={styles.parts}>
        {score.parts.map((p) => (
          <li key={p.key}>
            <div>
              <b>{p.label}</b>
              <small>{p.weight}% of score</small>
              <output>{p.score}</output>
            </div>
            <span className={styles.meter}>
              <i style={{ width: `${p.score}%`, background: p.score >= 70 ? 'var(--green)' : p.score >= 45 ? 'var(--amber)' : 'var(--danger)' }} />
            </span>
            <p>{p.detail}</p>
          </li>
        ))}
      </ul>

      <section className={styles.tips}>
        <h4>How to raise it</h4>
        {weakest.map((p) => (
          <p key={p.key}>
            <b>{p.label}:</b> {RAISE_TIPS[p.key]}
          </p>
        ))}
        <button type="button" className={styles.ask} onClick={onAskCritic}>
          <Sparkles size={14} /> Ask the AI critic for a tested fix
        </button>
      </section>

      {runs.length > 0 && (
        <section>
          <div className={styles.historyHead}>
            <h4>Your runs of this city</h4>
            <button type="button" onClick={() => clear(city)} title="Forget these runs" aria-label="Clear score history">
              <Trash2 size={13} />
            </button>
          </div>
          <History runs={runs} />
        </section>
      )}
      <p className={styles.fine}>The score weighs people kept safe, homes kept dry, response speed, open roads, power and hospitals. It is a simulation measure, not an official rating.</p>
    </div>
  );
}
