export interface LayaWorkerPort {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface LayaCandidate {
  id: string;
  description: string;
}

export interface LayaPrediction {
  choice: string;
  probabilities: Record<string, number>;
  durationMs: number;
}

interface Pending {
  candidates: readonly LayaCandidate[] | null;
  resolve(value: LayaPrediction | void): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function validatePrediction(message: Record<string, unknown>, candidates: readonly LayaCandidate[]): LayaPrediction {
  const ids = candidates.map((candidate) => candidate.id);
  const choice = message.choice;
  const probabilities = message.probabilities;
  const durationMs = message.durationMs;
  if (typeof choice !== 'string' || !ids.includes(choice) || !isRecord(probabilities) ||
      typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0 ||
      Object.keys(probabilities).length !== ids.length) throw new Error('Invalid Laya prediction');
  let sum = 0;
  const checked: Record<string, number> = {};
  for (const id of ids) {
    const probability = probabilities[id];
    if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error('Invalid Laya probability');
    }
    checked[id] = probability;
    sum += probability;
  }
  if (Math.abs(sum - 1) > 0.02) throw new Error('Invalid Laya probability distribution');
  return { choice, probabilities: checked, durationMs };
}

/** Correlates browser inference replies. Reset whenever the simulation is reloaded or sought. */
export class LayaClient {
  private generation = 0;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed = false;

  constructor(private readonly worker: LayaWorkerPort) {
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = (event) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(event.message || 'Laya worker failed to start'));
      }
      this.pending.clear();
    };
  }

  get pendingCount(): number { return this.pending.size; }

  load(): Promise<void> {
    return this.request<void>('load', null);
  }

  choose(state: string, candidates: readonly LayaCandidate[]): Promise<LayaPrediction> {
    if (!state.trim() || state.length > 2048 || candidates.length < 1 || candidates.length > 5 ||
        new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length ||
        candidates.some((candidate) => !/^h[1-9]\d*$/.test(candidate.id) || !candidate.description.trim() || candidate.description.length > 256)) {
      return Promise.reject(new Error('Invalid Laya decision request'));
    }
    return this.request<LayaPrediction>('predict', candidates, { state, candidates });
  }

  reset(): void {
    this.generation++;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Laya request reset'));
    }
    this.pending.clear();
  }

  close(): void {
    if (this.closed) return;
    this.reset();
    this.closed = true;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
  }

  private request<T>(type: 'load' | 'predict', candidates: readonly LayaCandidate[] | null,
    payload: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Laya worker closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Laya worker timed out'));
      }, type === 'load' ? 900_000 : 30_000);
      this.pending.set(id, { candidates, resolve: resolve as (value: LayaPrediction | void) => void, reject, timeout });
      this.worker.postMessage({ type, id, generation: this.generation, ...payload });
    });
  }

  private receive(raw: unknown): void {
    if (!isRecord(raw) || typeof raw.id !== 'number' || raw.generation !== this.generation) return;
    const pending = this.pending.get(raw.id);
    if (!pending) return;
    if (pending.candidates === null && raw.type === 'progress') return;
    clearTimeout(pending.timeout);
    this.pending.delete(raw.id);
    if (raw.type === 'error') {
      pending.reject(new Error(typeof raw.message === 'string' ? raw.message : 'Laya worker failed'));
      return;
    }
    if (pending.candidates === null && raw.type === 'ready') {
      pending.resolve();
      return;
    }
    if (pending.candidates !== null && raw.type === 'prediction') {
      try { pending.resolve(validatePrediction(raw, pending.candidates)); }
      catch (error) { pending.reject(error as Error); }
      return;
    }
    pending.reject(new Error('Invalid Laya worker response'));
  }
}
