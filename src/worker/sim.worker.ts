// Web Worker entry: the real simulator (or the preview model) behind the worker protocol.
import type { MainToWorker, WorkerToMain } from '../contracts';
import { SimHost } from './host';

interface WorkerScope {
  postMessage(msg: WorkerToMain, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<MainToWorker>) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;
const host = new SimHost((msg, transfer = []) => scope.postMessage(msg, transfer));
scope.onmessage = (e) => host.handle(e.data);
