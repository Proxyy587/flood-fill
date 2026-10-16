'use client';

import { useEffect, useRef, useState } from 'react';
import { LayaClient, type LayaPrediction } from '../../ai/decisions/layaClient';

const sample = {
  state: JSON.stringify({ setting: 'Synthetic flood rescue simulation', patientSeverity: 'severe', patientHealth: 20,
    feasibleHospitalCount: 2, rule: 'Choose among the listed feasible hospitals only.' }),
  candidates: [
    { id: 'h2', description: 'Hospital 2: 1 travel tick, 2 beds available, projected load score 1.00' },
    { id: 'h5', description: 'Hospital 5: 7 travel ticks, 10 beds available, projected load score 7.00' },
  ],
  deterministicChoice: 'h2',
};

export function LayaDiagnostics() {
  const client = useRef<LayaClient | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'deciding' | 'error'>('idle');
  const [error, setError] = useState('');
  const [prediction, setPrediction] = useState<LayaPrediction | null>(null);

  useEffect(() => () => { client.current?.close(); client.current = null; }, []);

  const load = async () => {
    setError('');
    setStatus('loading');
    if (!client.current) {
      const worker = new Worker(new URL('../../ai/decisions/laya.worker.ts', import.meta.url), { type: 'module', name: 'laya-inference' });
      client.current = new LayaClient(worker);
    }
    try { await client.current.load(); setStatus('ready'); }
    catch (cause) {
      client.current?.close();
      client.current = null;
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('error');
    }
  };

  const decide = async () => {
    if (!client.current) return;
    setError('');
    setPrediction(null);
    setStatus('deciding');
    try {
      setPrediction(await client.current.choose(sample.state, sample.candidates));
      setStatus('ready');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('error'); }
  };

  return <main style={{ maxWidth: 720, margin: '48px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
    <h1>Browser Laya decision lab</h1>
    <p>This opt-in lab runs the official Laya checkpoint through ONNX in a browser worker. It compares a sample hospital recommendation with FloodSim&apos;s deterministic choice. It does not alter the city.</p>
    <p><strong>Model:</strong> local files at <code>/models/laya</code>. The first load transfers roughly 1.7 GB for the English checkpoint and may take several minutes. No inference API or key is used.</p>
    <button type="button" onClick={load} disabled={status === 'loading' || status === 'deciding'}>
      {status === 'loading' ? 'Loading model…' : status === 'ready' ? 'Model loaded' : 'Load local model'}
    </button>
    <h2>Sample decision</h2>
    <p>Severe simulated casualty; two reachable, powered hospitals with available beds:</p>
    <ul>{sample.candidates.map((candidate) => <li key={candidate.id}>{candidate.description}</li>)}</ul>
    <p>Deterministic selector: <strong>Hospital 2</strong></p>
    <button type="button" onClick={decide} disabled={status !== 'ready'}>
      {status === 'deciding' ? 'Evaluating…' : 'Ask Laya'}
    </button>
    {prediction && <section aria-live="polite">
      <h2>Laya shadow result</h2>
      <p>Choice: <strong>Hospital {prediction.choice.slice(1)}</strong> · {prediction.durationMs.toFixed(1)} ms after loading · {prediction.choice === sample.deterministicChoice ? 'agrees with rules' : 'differs from rules'}</p>
      <ul>{sample.candidates.map((candidate) => <li key={candidate.id}>{candidate.id}: {((prediction.probabilities[candidate.id] ?? 0) * 100).toFixed(1)}%</li>)}</ul>
    </section>}
    {error && <p role="alert">Laya unavailable: {error}. Deterministic simulation remains available.</p>}
    <p><small>Simulation output; not an emergency-planning authority. This is an unvalidated shadow comparison on synthetic data.</small></p>
  </main>;
}
