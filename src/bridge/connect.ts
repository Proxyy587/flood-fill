import { sameEntity } from '../contracts';
import { editorBus, replayBus, selectBus } from './buses';
import { useSceneStore } from './sceneStore';
import type { SimBridge } from './SimBridge';
import { useSimFeedStore } from './simFeedStore';

const INSPECT_REFRESH_MS = 500;

/** Wires a bridge to the shared stores and buses. Returns a disposer. */
export const connectBridge = (bridge: SimBridge): (() => void) => {
  const scene = useSceneStore;
  const feed = useSimFeedStore;
  const offs: (() => void)[] = [];

  offs.push(
    bridge.on('reset', () => feed.getState().reset()),
    bridge.on('ready', (st) => {
      scene.setState({ connection: 'ready', error: null, scenario: st.scenario, seed: st.seed, maxTicks: st.maxTicks });
    }),
    bridge.on('status', (st) =>
      scene.setState({ tick: st.tick, playing: st.playing, speed: st.speed, dispatchMode: st.dispatchMode, maxTicks: st.maxTicks }),
    ),
    bridge.on('snapshot', (snap) => {
      const s = scene.getState();
      if (s.tick !== snap.tick || s.weather.rain !== snap.weather.rain || s.weather.wind !== snap.weather.wind) {
        scene.setState({ tick: snap.tick, weather: snap.weather });
      }
    }),
    bridge.on('events', (events) => feed.getState().append(events)),
    bridge.on('metrics', (frame) => feed.getState().pushMetrics(frame)),
    bridge.on('done', (summary) => feed.getState().finish(summary)),
    bridge.on('error', (message) => scene.setState({ connection: 'error', error: message })),
  );

  offs.push(
    editorBus.onDispatch((cmd) => bridge.edit(cmd)),
    replayBus.onSeek((tick) => bridge.seek(tick)),
    selectBus.onFocus((ref) => scene.getState().focus(ref)),
    selectBus.onSelect((ref) => scene.getState().select(ref)),
    selectBus.onHighlight((cells) => scene.setState({ highlightCells: cells })),
  );

  // Keep the inspector fresh for the selected entity.
  let inFlight = false;
  const refresh = async () => {
    const ref = scene.getState().selected;
    if (!ref || inFlight) return;
    inFlight = true;
    try {
      const data = await bridge.inspect(ref);
      if (sameEntity(scene.getState().selected, ref)) scene.setState({ inspector: data });
    } finally {
      inFlight = false;
    }
  };
  offs.push(
    scene.subscribe((s, prev) => {
      if (!sameEntity(s.selected, prev.selected)) void refresh();
    }),
  );
  const timer = setInterval(() => void refresh(), INSPECT_REFRESH_MS);
  offs.push(() => clearInterval(timer));

  return () => offs.forEach((off) => off());
};
