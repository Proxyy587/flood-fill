import { describe, expect, it } from 'vitest';
import { LayaClient, type LayaWorkerPort } from './layaClient';

class FakeWorker implements LayaWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void { this.sent.push(message); }
  terminate(): void { this.terminated = true; }
  reply(message: unknown): void { this.onmessage?.({ data: message } as MessageEvent<unknown>); }
  fail(message: string): void { this.onerror?.({ message } as ErrorEvent); }
}

describe('LayaClient', () => {
  it('matches a validated prediction to its request', async () => {
    const worker = new FakeWorker();
    const client = new LayaClient(worker);
    const prediction = client.choose('Two powered hospitals are reachable', [
      { id: 'h2', description: 'Hospital 2: 4 ticks away, 3 beds open' },
      { id: 'h5', description: 'Hospital 5: 6 ticks away, 8 beds open' },
    ]);
    const sent = worker.sent[0] as { id: number; generation: number };
    worker.reply({ type: 'prediction', id: sent.id, generation: sent.generation,
      choice: 'h5', probabilities: { h2: 0.2, h5: 0.8 }, durationMs: 4 });
    await expect(prediction).resolves.toMatchObject({ choice: 'h5', probabilities: { h2: 0.2, h5: 0.8 } });
  });

  it('rejects unknown choices and invalid distributions', async () => {
    const worker = new FakeWorker();
    const client = new LayaClient(worker);
    const prediction = client.choose('state', [{ id: 'h2', description: 'safe' }]);
    const sent = worker.sent[0] as { id: number; generation: number };
    worker.reply({ type: 'prediction', id: sent.id, generation: sent.generation,
      choice: 'h99', probabilities: { h2: Number.NaN }, durationMs: 1 });
    await expect(prediction).rejects.toThrow(/invalid/i);
  });

  it('bounds observation size before posting to the inference worker', async () => {
    const worker = new FakeWorker();
    const client = new LayaClient(worker);
    await expect(client.choose('x'.repeat(2049), [{ id: 'h2', description: 'safe' }])).rejects.toThrow(/invalid/i);
    expect(worker.sent).toHaveLength(0);
  });

  it('discards a reply from a previous generation after reset', async () => {
    const worker = new FakeWorker();
    const client = new LayaClient(worker);
    const prediction = client.choose('state', [{ id: 'h2', description: 'safe' }]);
    const sent = worker.sent[0] as { id: number; generation: number };
    client.reset();
    await expect(prediction).rejects.toThrow(/reset/i);
    worker.reply({ type: 'prediction', id: sent.id, generation: sent.generation,
      choice: 'h2', probabilities: { h2: 1 }, durationMs: 1 });
    expect(client.pendingCount).toBe(0);
  });

  it('reports worker load failure without changing any sim state', async () => {
    const worker = new FakeWorker();
    const client = new LayaClient(worker);
    const load = client.load();
    const sent = worker.sent[0] as { id: number; generation: number };
    worker.reply({ type: 'error', id: sent.id, generation: sent.generation, message: 'model missing' });
    await expect(load).rejects.toThrow('model missing');
    client.close();
    expect(worker.terminated).toBe(true);
  });

  it('keeps a load pending while the model reports progress', async () => {
    const worker = new FakeWorker();
    const client = new LayaClient(worker);
    const load = client.load();
    const sent = worker.sent[0] as { id: number; generation: number };
    worker.reply({ type: 'progress', id: sent.id, generation: sent.generation, done: 1, total: 2 });
    expect(client.pendingCount).toBe(1);
    worker.reply({ type: 'ready', id: sent.id, generation: sent.generation });
    await expect(load).resolves.toBeUndefined();
  });

  it('rejects pending work when the browser worker fails to start', async () => {
    const worker = new FakeWorker();
    const client = new LayaClient(worker);
    const load = client.load();
    worker.fail('worker import failed');
    await expect(load).rejects.toThrow('worker import failed');
    expect(client.pendingCount).toBe(0);
  });
});
