import { create } from 'zustand';
import { z } from 'zod';
import type { CityScore, ScorePartKey } from '../../ai/score';

export interface ScoreEntry {
  /** Wall-clock time the run finished (UI only, never fed to the sim). */
  at: number;
  city: string;
  seed: number;
  engine: string;
  minutes: number;
  total: number;
  grade: CityScore['grade'];
  parts: { key: ScorePartKey; score: number }[];
}

const STORAGE_KEY = 'floodsim.scores.v1';
const MAX_ENTRIES = 40;

const EntrySchema = z.object({
  at: z.number(),
  city: z.string(),
  seed: z.number(),
  engine: z.string(),
  minutes: z.number(),
  total: z.number(),
  grade: z.enum(['A', 'B', 'C', 'D', 'F']),
  parts: z.array(z.object({ key: z.enum(['lives', 'homes', 'response', 'mobility', 'power', 'care']), score: z.number() })),
});

/** "Riverside · branch · branch" and "Riverside" are the same city for comparison. */
export const cityKey = (name: string): string => name.split(' · ')[0].trim();

const load = (): ScoreEntry[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = z.array(EntrySchema).safeParse(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]'));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
};

interface ScoreState {
  history: ScoreEntry[];
  record: (entry: ScoreEntry) => void;
  clear: (city: string) => void;
}

export const useScoreStore = create<ScoreState>()((set, get) => ({
  history: load(),
  record: (entry) => {
    const history = [...get().history, entry].slice(-MAX_ENTRIES);
    set({ history });
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      // Storage full or blocked: keep the in-memory history.
    }
  },
  clear: (city) => {
    const history = get().history.filter((e) => cityKey(e.city) !== cityKey(city));
    set({ history });
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      // Ignore storage errors.
    }
  },
}));

/** Finished runs of this city (and its branches), oldest first. */
export const runsOf = (history: readonly ScoreEntry[], city: string): ScoreEntry[] => history.filter((e) => cityKey(e.city) === cityKey(city));
