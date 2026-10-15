import { describe, expect, it } from 'vitest';
import { BlockType, type MainToWorker, type WorkerToMain } from '../contracts';
import { mockScenario } from '../contracts/mocks';
import { editorBus, selectBus } from './buses';
import { connectBridge } from './connect';
import { useSceneStore } from './sceneStore';
import { SimBridge, type WorkerLike } from './SimBridge';
import { useSimFeedStore } from './simFeedStore';

/** Runs the real worker module in-process by faking the worker global scope. */
const inProcessWorker = async (): Promise<WorkerLike> => {
  const g = globalThis as unknown as {
    postMessage: (msg: WorkerToMain) => void;
    onmessage: ((e: { data: MainToWorker }) => void) | null;
  };
  const fake: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (msg) => g.onmessage?.({ data: structuredClone(msg) }),
    terminate: () => {},
  };
  g.postMessage = (msg) => fake.onmessage?.({ data: msg } as MessageEvent<WorkerToMain>);
  await import('./mockSim.worker');
  return fake;
};

describe('SimBridge + mock worker', () => {
  it('loads, steps, inspects and routes edits through the editor bus', async () => {
    const bridge = new SimBridge(await inProcessWorker());
    const disconnect = connectBridge(bridge);
    const worlds: number[][] = [];
    bridge.on('world', (w) => worlds.push(w.dirtyChunks));

    bridge.load(mockScenario(), 7, { maxTicks: 100 });
    expect(useSceneStore.getState().connection).toBe('ready');
    expect(bridge.world?.w).toBe(96);
    expect(bridge.snapshot?.tick).toBe(0);

    bridge.step(20);
    expect(bridge.snapshot?.tick).toBe(20);
    expect(useSceneStore.getState().tick).toBe(20);

    const npcId = bridge.snapshot?.npcs.id[0] ?? -1;
    const data = await bridge.inspect({ kind: 'npc', id: npcId });
    expect(data?.kind).toBe('npc');
    expect(data?.route?.cells.length).toBeGreaterThan(0);

    editorBus.dispatch({ kind: 'setBlock', cell: 0, block: BlockType.Drainage });
    expect(bridge.world?.blocks[0]).not.toBe(BlockType.Drainage);
    bridge.load(mockScenario(), 7, { maxTicks: 100, mode:'edit' });
    editorBus.dispatch({ kind: 'setBlock', cell: 0, block: BlockType.Drainage });
    expect(worlds[worlds.length - 1]).toContain(0);
    expect(bridge.world?.blocks[0]).toBe(BlockType.Drainage);

    selectBus.focus({ kind: 'npc', id: npcId });
    expect(useSceneStore.getState().camera.mode).toBe('focus');
    expect(useSceneStore.getState().selected).toEqual({ kind: 'npc', id: npcId });

    bridge.load(mockScenario(), 7, { maxTicks:100 });
    bridge.step(20);
    bridge.seek(5);
    expect(bridge.snapshot?.tick).toBe(5);
    expect(useSimFeedStore.getState().events.every((e, i, all) => i === 0 || all[i - 1].tick <= e.tick)).toBe(true);

    disconnect();
  });
});
