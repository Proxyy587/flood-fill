'use client';

import { FlaskConical, Hammer, Eye, Leaf, Sparkles, Wallet } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NpcParams, RunSummary, Scenario, ScenarioPatch, SimEngine } from '../../contracts';
import { replayBus, selectBus } from '../../bridge/buses';
import { prepareCritique, requestCritique } from '../../ai';
import { cachedCritique, cachedVerification } from '../../ai/cache';
import { BUDGET_TIERS, compileProposal, tierForCost, type BudgetTier } from '../../ai/patchCompiler';
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

const TIER_LABEL: Record<BudgetTier, string> = { low: 'Low', mid: 'Mid', high: 'High' };

/** Seeds and length of a verification: a few seeds on the fast preview model, one shorter run on the slower core. */
export function verifyPlan(engine: SimEngine, seed: number, runTicks: number): { seeds: number[]; ticks: number } {
  const ticks = Math.max(600, Math.min(engine === 'core' ? 900 : 1800, Math.round(runTicks / 60) * 60));
  return { seeds: engine === 'core' ? [seed] : [seed, seed + 1, seed + 2], ticks };
}

function previewProposal(create: number[], alter: number[]): void {
  selectBus.highlightProposal(create, alter);
  const all = create.length ? create : alter;
  if (!all.length) return;
  const mid = all[Math.floor(all.length / 2)];
  selectBus.focus({ kind: 'cell', id: mid });
}

function FindingCard({ f }: { f: Finding }) {
  const ticks = f.evidence.flatMap((e) => e.eventTicks ?? []);
  const cells = f.evidence.flatMap((e) => e.cells ?? []);
  const show = () => {
    if (ticks.length) replayBus.seek(ticks[0]);
    selectBus.highlightCells(cells);
    if (cells.length) selectBus.focus({ kind: 'cell', id: cells[0] });
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

function ScoreDelta({ result }: { result: Verification }) {
  const score = result.metrics.find((m) => m.key === 'score');
  if (!score) return null;
  const before = Math.round(score.baseline.mean);
  const after = Math.round(score.patched.mean);
  const d = after - before;
  return (
    <div className={styles.scoreDelta} data-verdict={score.verdict}>
      <span>
        Score <b>{before}</b> → <b>{after}</b>
      </span>
      <span className={styles.pill} data-tone={d > 0 ? 'good' : d < 0 ? 'bad' : 'warn'}>
        {d > 0 ? `+${d}` : d === 0 ? '±0' : `${d}`} pts
      </span>
    </div>
  );
}

function ProposalCard({
  p,
  scenario,
  run,
  settings,
  budget,
  eco,
  initial,
  onApply,
}: {
  p: Proposal;
  scenario: Scenario;
  run: RunSummary;
  settings: VerifySettings;
  budget: number;
  eco: boolean;
  initial: Verification | null;
  onApply: (patch: ScenarioPatch) => void;
}) {
  const compiled = useMemo(() => compileProposal(p, scenario, budget, { eco }), [p, scenario, budget, eco]);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<Verification | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const plan = verifyPlan(settings.engine, run.seed, run.metrics.at(-1)?.tick ?? 1800);
  const cost = compiled.ok ? compiled.patch.estimatedCost : p.cost;
  const tier = tierForCost(cost);

  const showPreview = () => {
    if (compiled.ok) previewProposal(compiled.create, compiled.alter);
  };

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
    <div
      className={styles.card}
      data-proposal
      data-clickable="true"
      role="button"
      tabIndex={0}
      onClick={showPreview}
      onKeyDown={(e) => e.key === 'Enter' && showPreview()}
    >
      <h4>
        {p.title}
        <span className={styles.costRow}>
          <span className={styles.pill} data-tone={cost <= budget ? 'good' : 'bad'}>
            cost {cost}
          </span>
          <span className={styles.pill}>{TIER_LABEL[tier]} tier</span>
          {eco && <span className={styles.pill} data-tone="good">Eco</span>}
        </span>
      </h4>
      <p>{p.rationale}</p>
      <p className={styles.muted}>
        <b>Hypothesis:</b> {p.expectedEffect}
      </p>
      {compiled.ok ? (
        <>
          <p className={styles.ghostLegend}>
            <span data-tone="create" /> Create ({compiled.create.length})
            <span data-tone="alter" /> Alter ({compiled.alter.length})
          </p>
          <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={styles.pill} data-tone="info" onClick={showPreview} title="Show green create / red alter ghosts on the map">
              <Eye size={12} /> Preview
            </button>
            <button
              type="button"
              className={styles.pill}
              data-tone="info"
              onClick={() => {
                selectBus.clearHighlights();
                onApply(compiled.patch);
              }}
              title="Branch the city and apply this change in the editor (undoable)"
            >
              <Hammer size={12} /> Apply
            </button>
            <button type="button" className={styles.pill} data-tone="good" disabled={progress !== null} onClick={() => void verify()} title={`Re-run ${plan.seeds.length} seed${plan.seeds.length === 1 ? '' : 's'} with and without the change`}>
              <FlaskConical size={12} /> {progress ?? 'Verify'}
            </button>
          </div>
          {compiled.clamped && <p className={styles.muted}>Part of this change fell outside the city and was clipped to the edge.</p>}
          {result && (
            <>
              <ScoreDelta result={result} />
              <Comparison result={result} before="Now" after="With change" />
            </>
          )}
          {error && <p className={styles.muted}>Verification failed: {error}</p>}
        </>
      ) : (
        <p className={styles.muted}>Rejected by the safety compiler: {compiled.errors.slice(0, 2).join(' ')}</p>
      )}
    </div>
  );
}

function BudgetStrip({
  tier,
  eco,
  onTier,
  onEco,
}: {
  tier: BudgetTier;
  eco: boolean;
  onTier: (t: BudgetTier) => void;
  onEco: (v: boolean) => void;
}) {
  return (
    <div className={styles.budgetStrip} role="group" aria-label="Suggestion budget">
      <div className={styles.budgetHead}>
        <Wallet size={16} />
        <div>
          <b>Budget for suggestions</b>
          <small>Low / Mid / High cost caps · Eco prefers drainage, trees and levees</small>
        </div>
      </div>
      <div className={styles.budgetTiers}>
        {(Object.keys(BUDGET_TIERS) as BudgetTier[]).map((t) => (
          <button key={t} type="button" className={styles.tierBtn} data-active={tier === t} onClick={() => onTier(t)}>
            <span>{TIER_LABEL[t]}</span>
            <em>{BUDGET_TIERS[t]}</em>
          </button>
        ))}
        <button type="button" className={styles.ecoBtn} data-active={eco} onClick={() => onEco(!eco)} title="Prefer the most efficient green interventions">
          <Leaf size={14} /> Eco
        </button>
      </div>
    </div>
  );
}

/** "Critique run": findings, proposals, and simulation-verified before/after. */
export function CriticPanel({
  run,
  scenario,
  settings,
  onApply,
  autoAsk = false,
}: {
  run: RunSummary | null;
  scenario: Scenario;
  settings: VerifySettings;
  onApply: (patch: ScenarioPatch) => void;
  /** When true, request a critique once a long enough run is ready. */
  autoAsk?: boolean;
}) {
  const [response, setResponse] = useState<CriticResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [tier, setTier] = useState<BudgetTier>('mid');
  const [eco, setEco] = useState(false);
  const budget = BUDGET_TIERS[tier];
  const cached = cachedCritique(scenario.name);
  const ready = run !== null && (run.metrics.at(-1)?.tick ?? 0) >= 300;
  const autoAsked = useRef(false);

  useEffect(() => () => selectBus.clearHighlights(), []);

  const ask = async () => {
    if (!run) return;
    setLoading(true);
    try {
      setResponse(await requestCritique(prepareCritique(run, scenario, { budget, eco })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!autoAsk || !ready || !run || autoAsked.current) return;
    autoAsked.current = true;
    let cancelled = false;
    setLoading(true);
    void requestCritique(prepareCritique(run, scenario, { budget, eco })).then((r) => {
      if (!cancelled) setResponse(r);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [autoAsk, ready, run, scenario, budget, eco]);

  return (
    <>
      <BudgetStrip tier={tier} eco={eco} onTier={setTier} onEco={setEco} />

      <section className={styles.section}>
        <span className={styles.label}>
          <Sparkles size={13} /> AI suggestions · verified by re-simulation
        </span>
        <p className={styles.muted}>
          The critic reads this run’s metrics and event log, then proposes changes within the <b>{TIER_LABEL[tier]}</b> budget ({budget}
          {eco ? ', eco filter on' : ''}). Preview paints green (create) and red (alter) on the map. Nothing changes until you Apply; Verify re-runs the storm with and without the change.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.pill} data-tone="info" disabled={!ready || loading} onClick={() => void ask()}>
            {loading ? 'Reading the run…' : response ? 'Ask again with this budget' : 'Ask for feedback'}
          </button>
          {cached && !response && (
            <button type="button" className={styles.pill} onClick={() => setResponse(cached)}>
              Open cached example
            </button>
          )}
          {response && (
            <button type="button" className={styles.pill} onClick={() => selectBus.clearHighlights()}>
              Clear map ghosts
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
          <section className={`${styles.section} ${styles.suggestions}`}>
            <h3 className={styles.heading}>
              Suggestions <span>green = create · red = alter</span>
            </h3>
            {response.report.proposals.map((p) => (
              <ProposalCard
                key={p.id}
                p={p}
                scenario={scenario}
                run={run ?? { scenario: scenario.name, seed: scenario.defaults.seed, mode: settings.dispatchMode, metrics: [], events: [], hotspots: [] }}
                settings={settings}
                budget={budget}
                eco={eco}
                initial={response.source === 'cache' ? cachedVerification(scenario.name, p.id) : null}
                onApply={onApply}
              />
            ))}
            {!response.report.proposals.length && <p className={styles.muted}>No executable change proposed for this budget.</p>}
          </section>
          <section className={styles.section}>
            <Limitations extra={response.report.limitations} />
          </section>
        </>
      )}
    </>
  );
}
