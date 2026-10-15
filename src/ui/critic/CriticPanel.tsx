'use client';

import { FlaskConical, Hammer, Eye, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { NpcParams, RunSummary, Scenario, ScenarioPatch, SimEngine } from '../../contracts';
import { replayBus, selectBus } from '../../bridge/buses';
import { prepareCritique, requestCritique } from '../../ai';
import { cachedCritique, cachedVerification } from '../../ai/cache';
import { compileProposal } from '../../ai/patchCompiler';
import type { CriticResponse, Finding, Proposal } from '../../ai/schema';
import type { Verification } from '../../ai/verify';
import { verifyInWorker } from '../../ai/verifyClient';
import { Comparison } from '../dashboard/Compare';
import { Limitations } from './Limitations';
import styles from '../dashboard/report.module.css';

export interface VerifySettings {
  engine: SimEngine;
  dispatchMode: RunSummary['mode'];
  npcParams: NpcParams;
  startTimeSeconds: number;
}

const SOURCE: Record<CriticResponse['source'], { label: string; tone: string }> = {
  llm: { label: 'Language-model critic', tone: 'info' },
  fallback: { label: 'Rule-based analysers', tone: 'warn' },
  cache: { label: 'Cached example report', tone: 'warn' },
};

/** Seeds and length of a verification: a few seeds on the fast preview model, one shorter run on the slower core. */
export function verifyPlan(engine: SimEngine, seed: number, runTicks: number): { seeds: number[]; ticks: number } {
  const ticks = Math.max(600, Math.min(engine === 'core' ? 900 : 1800, Math.round(runTicks / 60) * 60));
  return { seeds: engine === 'core' ? [seed] : [seed, seed + 1, seed + 2], ticks };
}

function FindingCard({ f }: { f: Finding }) {
  const ticks = f.evidence.flatMap((e) => e.eventTicks ?? []);
  const cells = f.evidence.flatMap((e) => e.cells ?? []);
  const show = () => {
    if (ticks.length) replayBus.seek(ticks[0]);
    selectBus.highlightCells(cells);
  };
  return (
    <div className={styles.card} data-clickable={ticks.length > 0 || cells.length > 0} role="button" tabIndex={0} onClick={show} onKeyDown={(e) => e.key === 'Enter' && show()}>
      <h4>
        {f.title}
        <span className={styles.pill} data-tone={f.severity === 'high' ? 'bad' : f.severity === 'medium' ? 'warn' : undefined}>
          {f.severity}
        </span>
      </h4>
      <p>{f.explanation}</p>
      <p className={styles.muted}>
        Confidence {f.confidence}
        {cells.length ? ` · ${cells.length} cells on the map` : ''}
        {ticks.length ? ` · evidence at tick ${ticks.slice(0, 3).join(', ')}` : ''}
      </p>
    </div>
  );
}

function ProposalCard({ p, scenario, run, settings, initial, onApply }: { p: Proposal; scenario: Scenario; run: RunSummary; settings: VerifySettings; initial: Verification | null; onApply: (patch: ScenarioPatch) => void }) {
  const compiled = useMemo(() => compileProposal(p, scenario), [p, scenario]);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<Verification | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const plan = verifyPlan(settings.engine, run.seed, run.metrics.at(-1)?.tick ?? 1800);
  const verify = async () => {
    if (!compiled.ok) return;
    setError(null);
    setResult(null);
    setProgress('Starting…');
    try {
      const r = await verifyInWorker(scenario, compiled.patch, { ...settings, ...plan }, (d, t) => setProgress(`Re-running ${d} of ${t}…`));
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };
  return (
    <div className={styles.card}>
      <h4>
        {p.title}
        <span className={styles.pill}>cost {compiled.ok ? compiled.patch.estimatedCost : p.cost}</span>
      </h4>
      <p>{p.rationale}</p>
      <p className={styles.muted}>
        <b>Hypothesis:</b> {p.expectedEffect}
      </p>
      {compiled.ok ? (
        <>
          <div className={styles.actions}>
            <button type="button" className={styles.pill} data-tone="info" onClick={() => selectBus.highlightCells(compiled.cells)} title="Highlight the cells this would change">
              <Eye size={12} /> Preview
            </button>
            <button type="button" className={styles.pill} data-tone="info" onClick={() => onApply(compiled.patch)} title="Branch the city and apply this change in the editor (undoable)">
              <Hammer size={12} /> Apply
            </button>
            <button type="button" className={styles.pill} data-tone="good" disabled={progress !== null} onClick={() => void verify()} title={`Re-run ${plan.seeds.length} seed${plan.seeds.length === 1 ? '' : 's'} with and without the change`}>
              <FlaskConical size={12} /> {progress ?? 'Verify'}
            </button>
          </div>
          {compiled.clamped && <p className={styles.muted}>Part of this change fell outside the city and was clipped to the edge.</p>}
          {result && <Comparison result={result} before="Now" after="With change" />}
          {error && <p className={styles.muted}>Verification failed: {error}</p>}
        </>
      ) : (
        <p className={styles.muted}>Rejected by the safety compiler: {compiled.errors.slice(0, 2).join(' ')}</p>
      )}
    </div>
  );
}

/** "Critique run": findings, proposals, and simulation-verified before/after. */
export function CriticPanel({ run, scenario, settings, onApply }: { run: RunSummary | null; scenario: Scenario; settings: VerifySettings; onApply: (patch: ScenarioPatch) => void }) {
  const [response, setResponse] = useState<CriticResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const cached = cachedCritique(scenario.name);
  const ask = async () => {
    if (!run) return;
    setLoading(true);
    try {
      setResponse(await requestCritique(prepareCritique(run, scenario)));
    } finally {
      setLoading(false);
    }
  };
  const ready = run !== null && (run.metrics.at(-1)?.tick ?? 0) >= 300;

  return (
    <>
      <section className={styles.section}>
        <span className={styles.label}>
          <Sparkles size={13} /> AI-generated hypothesis, verified by simulation
        </span>
        <p className={styles.muted}>The critic reads this run’s metrics and event log, names what went wrong, and proposes small changes. Nothing changes until you apply a proposal; Verify re-runs the storm with and without it.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.pill} data-tone="info" disabled={!ready || loading} onClick={() => void ask()}>
            {loading ? 'Reading the run…' : response ? 'Critique again' : 'Critique this run'}
          </button>
          {cached && !response && (
            <button type="button" className={styles.pill} onClick={() => setResponse(cached)}>
              Open cached example
            </button>
          )}
        </div>
        {!ready && <p className={styles.muted}>Run the storm for at least five simulated minutes first.</p>}
      </section>

      {response && (
        <>
          <section className={styles.section}>
            <h3 className={styles.heading}>
              Summary
              <span className={styles.pill} data-tone={SOURCE[response.source].tone}>
                {SOURCE[response.source].label}
              </span>
            </h3>
            {response.notice && <p className={styles.muted}>{response.notice}</p>}
            <p className={styles.muted} style={{ color: 'var(--ink)' }}>
              {response.report.summary}
            </p>
          </section>
          <section className={styles.section}>
            <h3 className={styles.heading}>
              Findings <span>click to jump to the evidence</span>
            </h3>
            {response.report.findings.map((f) => (
              <FindingCard key={f.id} f={f} />
            ))}
            {!response.report.findings.length && <p className={styles.muted}>No findings.</p>}
          </section>
          <section className={styles.section}>
            <h3 className={styles.heading}>Proposals</h3>
            {response.report.proposals.map((p) => (
              <ProposalCard key={p.id} p={p} scenario={scenario} run={run ?? { scenario: scenario.name, seed: scenario.defaults.seed, mode: settings.dispatchMode, metrics: [], events: [], hotspots: [] }} settings={settings} initial={response.source === 'cache' ? cachedVerification(scenario.name, p.id) : null} onApply={onApply} />
            ))}
            {!response.report.proposals.length && <p className={styles.muted}>No executable change proposed.</p>}
          </section>
          <section className={styles.section}>
            <Limitations extra={response.report.limitations} />
          </section>
        </>
      )}
    </>
  );
}
