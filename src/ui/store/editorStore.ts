'use client';

import { create } from 'zustand';
import { DEFAULT_NPC_PARAMS, BlockType, type NpcParams, type Scenario } from '../../contracts';
import { NpcParamsSchema } from '../../contracts/schemas';
import { DEFAULT_HOTBAR } from '../../editor/catalog';
import { historyEntry, type HistoryEntry } from '../../editor/commands';
import { checkCity } from '../../editor/persistence';

export type EditorTool = 'select' | 'place' | 'line' | 'rect' | 'erase' | 'raise' | 'lower' | 'building' | 'eyedropper' | 'power' | 'move';
export const TOOLS: { id: EditorTool; label: string; icon: string }[] = [
  { id: 'select', label: 'Inspect', icon: '↖' }, { id: 'place', label: 'Paint', icon: '▧' },
  { id: 'line', label: 'Road / line', icon: '╱' }, { id: 'rect', label: 'Rectangle', icon: '□' },
  { id: 'erase', label: 'Erase', icon: '⌫' }, { id: 'raise', label: 'Raise', icon: '↑' },
  { id: 'lower', label: 'Lower', icon: '↓' }, { id: 'building', label: 'Building', icon: '▥' },
  { id: 'eyedropper', label: 'Sample', icon: '⊙' }, { id: 'power', label: 'Power line', icon: 'ϟ' },
  { id: 'move', label: 'Move building', icon: '↔' },
];

interface EditorState {
  scenario: Scenario | null;
  mode: 'edit' | 'run' | 'replay';
  tool: EditorTool;
  block: BlockType;
  brush: number;
  heightAmount: number;
  slot: number;
  hotbar: BlockType[];
  params: NpcParams;
  past: HistoryEntry[];
  future: HistoryEntry[];
  revision: number;
  preview: number[];
  previewValid: boolean;
  notice: string;
  moveSource: number | null;
  powerSource: number | null;
  load: (scenario: Scenario) => void;
  commit: (commands: HistoryEntry['commands']) => void;
  undo: () => void;
  redo: () => void;
  setParam: (key: keyof NpcParams, value: number) => void;
  pickSlot: (slot: number) => void;
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  scenario: null, mode: 'edit', tool: 'select', block: BlockType.Road, brush: 1, heightAmount: 1,
  slot: 0, hotbar: [...DEFAULT_HOTBAR], params: { ...DEFAULT_NPC_PARAMS }, past: [], future: [], revision: 0,
  preview: [], previewValid: true, notice: 'Choose a tool to shape your city.', moveSource: null, powerSource: null,
  load: (scenario) => {checkCity(scenario);set(s => ({ scenario: structuredClone(scenario), past: [], future: [], revision: s.revision + 1,
    preview: [], moveSource: null, powerSource: null, mode: 'edit', notice: 'City loaded. Edits are enabled.',
    params: { ...s.params, carOwnership: scenario.population.mix.carOwners, warningDelay: scenario.weather.warningDelay } }));},
  commit: (commands) => {
    const s = get(); if (!s.scenario || s.mode !== 'edit' || !commands.length) return;
    const entry = historyEntry(s.scenario, commands);
    set({ scenario: entry.after, past: [...s.past.slice(-99), entry], future: [], revision: s.revision + 1, notice: `Applied ${commands.length} command${commands.length === 1 ? '' : 's'}.` });
  },
  undo: () => {
    const s = get(), entry = s.past.at(-1); if (s.mode !== 'edit' || !entry) return;
    set({ scenario: entry.before, past: s.past.slice(0, -1), future: [...s.future, entry], revision: s.revision + 1, notice: 'Edit undone.' });
  },
  redo: () => {
    const s = get(), entry = s.future.at(-1); if (s.mode !== 'edit' || !entry) return;
    set({ scenario: entry.after, past: [...s.past, entry], future: s.future.slice(0, -1), revision: s.revision + 1, notice: 'Edit restored.' });
  },
  setParam: (key, value) => {
    const params = NpcParamsSchema.parse({ ...get().params, [key]: value });
    const scenario = get().scenario;
    if (!scenario || get().mode !== 'edit') return;
    const next = structuredClone(scenario);
    next.population.mix.carOwners = params.carOwnership;
    next.weather.warningDelay = params.warningDelay;
    set(s => ({ params, scenario: next, revision: s.revision + 1, past:[], future:[] }));
  },
  pickSlot: (slot) => set(s => ({ slot, block: s.hotbar[slot], tool: s.hotbar[slot] >= BlockType.House && s.hotbar[slot] <= BlockType.Substation ? 'building' : 'place', moveSource: null, powerSource: null })),
}));
