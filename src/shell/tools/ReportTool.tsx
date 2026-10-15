'use client';

import { Download, Scale } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RunSummary, ScenarioPatch } from '../../contracts';
import { useSceneStore } from '../../bridge/sceneStore';
import { useSimFeedStore } from '../../bridge/simFeedStore';
import { analyseRun } from '../../ai/analysers';
import { cityIndex } from '../../ai/cityIndex';
import type { Verification } from '../../ai/verify';
import { verifyInWorker } from '../../ai/verifyClient';
import { Comparison } from '../../ui/dashboard/Compare';
import { Dashboard } from '../../ui/dashboard/Dashboard';
import { runReportMarkdown } from '../../ui/dashboard/runStats';
import { CriticPanel, verifyPlan } from '../../ui/critic/CriticPanel';
import { Limitations } from '../../ui/critic/Limitations';
import { topIncidents } from '../../ui/replay/afterAction';
import { ReplayPanel } from '../../ui/replay/ReplayPanel';
import { ScorePanel } from '../../ui/score/ScoreCard';
import { useEditorStore } from '../../ui/store/editorStore';
import { clockOf, useCityStore } from '../city';
import { Flyout, Segmented } from '../primitives';
import styles from '../shell.module.css';

export type ReportTab = 'score' | 'charts' | 'why' | 'critic' | 'compare';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CompareModes({ run }: { run: RunSummary }) {
  const scenario = useEditorStore((s) => s.scenario);
  const params = useEditorStore((s) => s.params);
  const engine = useSceneStore((s) => s.engine);
  const startSeconds = useSceneStore((s) => s.startSeconds);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!scenario) return null;
  const plan = verifyPlan(engine, run.seed, run.metrics.at(-1)?.tick ?? 1800);
  const go = async () => {
    setError(null);
    setProgress('Starting…');
    try {
      setResult(await verifyInWorker(scenario, null, { ...plan, engine, dispatchMode: 'negotiation', npcParams: params, startTimeSeconds: startSeconds }, (d, t) => setProgress(`Running ${d} of ${t}…`)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };
  return (
    <>
      <p className={styles.hint}>
        Runs this city with units negotiating among themselves (the decentralised policy) and with one HQ dispatcher assigning everything (the centralised baseline), on the same {plan.seeds.length} seed{plan.seeds.length === 1 ? '' : 's'}, and compares them.
      </p>
      <button type="button" className={styles.button} disabled={progress !== null} onClick={() => void go()}>
        <Scale size={14} /> {progress ?? (result ? 'Run again' : 'Compare dispatch policies')}
      </button>
      {result && <Comparison result={result} before="Units negotiate" after="HQ assigns" policies />}
      {error && <p className={styles.note}>{error}</p>}
      <Limitations />
    </>
  );
}

/** Charts, the replay explainer, the AI critic and the policy comparison for the current run. */
export function ReportTool({ onClose, onApply, initialTab = 'score' }: { onClose: () => void; onApply: (patch: ScenarioPatch) => void; initialTab?: ReportTab }) {
  const [tab, setTab] = useState<ReportTab>(initialTab);
  const scenario = useEditorStore((s) => s.scenario);
  const params = useEditorStore((s) => s.params);
  const { events, metrics, done } = useSimFeedStore();
  const seed = useSceneStore((s) => s.seed);
  const engine = useSceneStore((s) => s.engine);
  const startSeconds = useSceneStore((s) => s.startSeconds);
  const selected = useSceneStore((s) => s.selected);
  const names = useCityStore((s) => s.names);
  const run = useMemo<RunSummary | null>(
    () => done ?? (scenario && metrics.length ? { scenario: scenario.name, seed, mode: scenario.defaults.dispatchMode, metrics, events, hotspots: [] } : null),
    [done, scenario, seed, metrics, events],
  );
  if (!scenario) return null;
  const exportReport = () => {
    if (!run) return;
    const md = runReportMarkdown({ run, scenario, analyses: analyseRun(run, cityIndex(scenario)), incidents: topIncidents(run.events), clock: clockOf });
    download(`${scenario.name.replace(/[^a-z0-9_-]/gi, '-')}-seed${run.seed}-report.md`, md);
  };

  return (
    <Flyout title="Report" subtitle="What happened, why, and what to change." onClose={onClose} wide>
      <Segmented
        label="Report section"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'score', label: 'Score' },
          { id: 'charts', label: 'Charts' },
          { id: 'why', label: 'Why' },
          { id: 'critic', label: 'Critic' },
          { id: 'compare', label: 'Compare' },
        ]}
      />
      {tab === 'score' && <ScorePanel onAskCritic={() => setTab('critic')} />}
      {tab === 'charts' && (
        <>
          <Dashboard metrics={metrics} events={events} scenario={scenario} names={names} />
          <button type="button" className={styles.button} disabled={!run} onClick={exportReport}>
            <Download size={14} /> Download run report
          </button>
        </>
      )}
      {tab === 'why' && <ReplayPanel events={events} selected={selected} clock={clockOf} />}
      {tab === 'critic' && <CriticPanel run={run} scenario={scenario} settings={{ engine, dispatchMode: run?.mode ?? scenario.defaults.dispatchMode, npcParams: params, startTimeSeconds: startSeconds }} onApply={onApply} />}
      {tab === 'compare' && (run ? <CompareModes run={run} /> : <p className={styles.hint}>Start the storm first; the comparison re-runs this city in the background.</p>)}
    </Flyout>
  );
}
