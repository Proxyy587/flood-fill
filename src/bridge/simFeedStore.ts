import { create } from 'zustand';
import type { MetricsFrame, RunSummary, SimEvent } from '../contracts';

/** The run's append-only event log and metrics stream, for the dashboard, replay and critic. */
export interface SimFeedState {
  events: SimEvent[];
  metrics: MetricsFrame[];
  done: RunSummary | null;
  append: (events: SimEvent[]) => void;
  pushMetrics: (frame: MetricsFrame) => void;
  finish: (summary: RunSummary) => void;
  reset: () => void;
}

export const useSimFeedStore = create<SimFeedState>()((set) => ({
  events: [],
  metrics: [],
  done: null,
  append: (events) => {
    if (events.length) set((s) => ({ events: s.events.concat(events) }));
  },
  pushMetrics: (frame) =>
    set((s) => {
      const last = s.metrics[s.metrics.length - 1];
      return last && last.tick >= frame.tick ? s : { metrics: [...s.metrics, frame] };
    }),
  finish: (summary) => set({ done: summary }),
  reset: () => set({ events: [], metrics: [], done: null }),
}));
