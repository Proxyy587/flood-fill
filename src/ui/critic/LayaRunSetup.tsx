'use client';

import { useEffect, useRef, useState } from 'react';
import type { Scenario } from '../../contracts';
import { useSceneStore } from '../../bridge/sceneStore';
import { LayaClient } from '../../ai/decisions/layaClient';
import { applicableLayaTape, prepareLayaRun, scenarioFingerprint, type PreparedLayaRun } from '../../ai/decisions/runTape';
import styles from '../../shell/shell.module.css';

export function LayaRunSetup({ scenario, disabled }: { scenario: Scenario; disabled: boolean }) {
  const client = useRef<LayaClient | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<PreparedLayaRun | null>(null);
  const tape = useSceneStore((state) => state.layaTape);
  const setLayaTape = useSceneStore((state) => state.setLayaTape);
  const fingerprint = scenarioFingerprint(scenario);
  const active = applicableLayaTape(scenario, scenario.defaults.seed, tape);
  const preview = prepared?.tape.scenarioFingerprint === fingerprint && prepared.tape.seed === scenario.defaults.seed ? prepared : null;

  useEffect(() => () => { client.current?.close(); client.current = null; }, []);

  const prepare = async () => {
    setBusy(true);
    setError('');
    setPrepared(null);
    try {
      if (!client.current) {
        const worker = new Worker(new URL('../../ai/decisions/laya.worker.ts', import.meta.url), { type: 'module', name: 'laya-run-decisions' });
        client.current = new LayaClient(worker);
      }
      await client.current.load();
      const result = await prepareLayaRun(scenario, client.current);
      setPrepared(result);
    } catch (cause) {
      client.current?.close();
      client.current = null;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const choices = preview?.tape;
  return <div className={styles.group}>
    <div className={styles.groupTitle}>Laya decisions</div>
    <p className={styles.hint}>Optional browser ONNX policy for the next Core run. Downloads the local model on first use. Laya picks dispatch mode and hospital preferences; the simulator checks live safety and available beds.</p>
    <div className={styles.row}>
      <button type="button" className={styles.button} disabled={disabled || busy} onClick={() => void prepare()}>
        {busy ? 'Preparing Laya decisions…' : 'Prepare Laya decisions'}
      </button>
      {active && <button type="button" className={styles.button} disabled={disabled} onClick={() => setLayaTape(null)}>Use rules instead</button>}
    </div>
    {choices && <div aria-live="polite">
      <p className={styles.hint}>Proposed dispatch: <b>{choices.dispatchMode}</b>. Hospitals: minor <b>{choices.hospitalPreference.minor ?? 'none'}</b>, moderate <b>{choices.hospitalPreference.moderate ?? 'none'}</b>, severe <b>{choices.hospitalPreference.severe ?? 'none'}</b>.</p>
      <p className={styles.hint}>Model choice probabilities: {Object.entries(preview.predictions).map(([key, prediction]) => `${key} ${Math.round((prediction.probabilities[prediction.choice] ?? 0) * 100)}%`).join(' · ')}. These are uncalibrated model outputs.</p>
      <button type="button" className={styles.button} disabled={disabled} onClick={() => setLayaTape(choices)}>Use for next Core run</button>
    </div>}
    {active && <p className={styles.hint}>Laya decisions active for this city and seed. The recorded choices replay with the run.</p>}
    {tape && !active && <p className={styles.hint}>Previous Laya decisions expired after a city or seed change.</p>}
    {error && <p role="alert" className={styles.note}>Laya unavailable: {error}. Existing run settings still work.</p>}
    <p className={styles.hint}>Simulation output; not an emergency-planning authority.</p>
  </div>;
}
