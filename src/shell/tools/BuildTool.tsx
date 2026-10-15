'use client';

import { ArrowDownToLine, ArrowUpToLine, Building2, Cable, Eraser, GitBranch, Move, Paintbrush, PenLine, Pipette, Redo2, SquareDashed, Undo2, Waves } from 'lucide-react';
import { useMemo, useState, type ComponentType } from 'react';
import type { BlockType } from '../../contracts';
import { BLOCK_META, CATEGORIES } from '../../editor/catalog';
import { cityWarnings } from '../../editor/validation';
import { BLOCK_VISUALS } from '../../render/palette';
import { useEditorStore, type EditorTool } from '../../ui/store/editorStore';
import { Flyout, Segmented, Slider, Stepper } from '../primitives';
import styles from '../shell.module.css';

export const blockColor = (b: BlockType) => `#${BLOCK_VISUALS[b].top.toString(16).padStart(6, '0')}`;

const BUILD_TOOLS: { id: EditorTool; label: string; icon: ComponentType<{ size?: number }>; hint: string }[] = [
  { id: 'place', label: 'Paint', icon: Paintbrush, hint: 'Drag to paint the chosen surface.' },
  { id: 'line', label: 'Line', icon: PenLine, hint: 'Drag from start to end to lay a straight road or line.' },
  { id: 'rect', label: 'Area', icon: SquareDashed, hint: 'Drag a rectangle to fill an area.' },
  { id: 'building', label: 'Building', icon: Building2, hint: 'Click a level spot beside a road to place the building.' },
  { id: 'move', label: 'Move', icon: Move, hint: 'Click a building, then click where it should go.' },
  { id: 'power', label: 'Power', icon: Cable, hint: 'Click a substation, then a building to connect it.' },
  { id: 'eyedropper', label: 'Sample', icon: Pipette, hint: 'Click the map to pick up that block.' },
  { id: 'erase', label: 'Erase', icon: Eraser, hint: 'Drag to clear back to grass.' },
];

const PAINTABLE: EditorTool[] = ['place', 'line', 'rect'];

function Locked({ onBranch }: { onBranch: () => void }) {
  return (
    <>
      <p className={styles.note}>The storm is running, so the city is locked. Branch it to try a change, then run the storm again to compare.</p>
      <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onBranch}>
        <GitBranch size={15} /> Branch and edit
      </button>
    </>
  );
}

function UndoRow() {
  const { past, future, undo, redo } = useEditorStore();
  return (
    <div className={styles.row}>
      <button type="button" className={`${styles.button} ${styles.grow}`} disabled={!past.length} onClick={undo} title="Undo (⌘Z)">
        <Undo2 size={14} /> Undo
      </button>
      <button type="button" className={`${styles.button} ${styles.grow}`} disabled={!future.length} onClick={redo} title="Redo (⇧⌘Z)">
        <Redo2 size={14} /> Redo
      </button>
    </div>
  );
}

function blockTip(type: BlockType): string {
  const m = BLOCK_META[type];
  const size = `${m.footprint * 4} × ${m.footprint * 4} m`;
  const stats = m.building && m.capacity ? ` · holds ${m.capacity}` : '';
  return `${m.name} (${size}${stats})\n${m.description}${m.floodEffect ? `\nIn a flood: ${m.floodEffect}` : ''}`;
}

export function BuildTool({ onClose, onBranch }: { onClose: () => void; onBranch: () => void }) {
  const state = useEditorStore();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>(() => BLOCK_META[state.block].category);
  const warnings = useMemo(() => (state.scenario ? cityWarnings(state.scenario) : []), [state.scenario]);
  const locked = state.mode !== 'edit';
  const tool = BUILD_TOOLS.find((t) => t.id === state.tool);
  const active = BLOCK_META[state.block];
  const choose = (type: BlockType) =>
    useEditorStore.setState((s) => ({
      block: type,
      tool: BLOCK_META[type].building ? 'building' : PAINTABLE.includes(s.tool) ? s.tool : 'place',
      hotbar: s.hotbar.map((b, i) => (i === s.slot ? type : b)),
      preview: [],
    }));
  return (
    <Flyout title="Build" subtitle="Lay roads, place buildings and wire power." onClose={onClose}>
      {locked ? (
        <Locked onBranch={onBranch} />
      ) : (
        <>
          <div className={styles.group}>
            <div className={styles.toolGrid}>
              {BUILD_TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={state.tool === t.id}
                  onClick={() => useEditorStore.setState({ tool: t.id, preview: [], moveSource: null, powerSource: null })}
                >
                  <t.icon size={17} />
                  {t.label}
                </button>
              ))}
            </div>
            {tool && <p className={styles.hint}>{tool.hint}</p>}
          </div>

          <div className={styles.group}>
            <div className={styles.chips} role="group" aria-label="Block category">
              {CATEGORIES.map((c) => (
                <button key={c} type="button" aria-pressed={c === category} onClick={() => setCategory(c)}>
                  {c}
                </button>
              ))}
            </div>
            <div className={styles.palette}>
              {Object.values(BLOCK_META)
                .filter((m) => m.category === category)
                .map((m) => (
                  <button key={m.type} type="button" aria-pressed={m.type === state.block} onClick={() => choose(m.type)} title={blockTip(m.type)}>
                    <span className={styles.swatch} style={{ background: blockColor(m.type) }} />
                    {m.name}
                  </button>
                ))}
            </div>
            <p className={styles.hint}>
              <strong style={{ color: 'var(--ink)' }}>{active.name}</strong>, {active.footprint * 4} × {active.footprint * 4} m. {active.description}
            </p>
            {active.floodEffect && (
              <p className={styles.floodEffect}>
                <Waves size={14} aria-hidden /> <span><strong>In a flood:</strong> {active.floodEffect}</span>
              </p>
            )}
          </div>

          {(state.tool === 'place' || state.tool === 'erase') && (
            <Slider label="Brush" value={state.brush} display={`${state.brush * 4} m`} min={1} max={9} step={2} onChange={(v) => useEditorStore.setState({ brush: v })} />
          )}

          <UndoRow />

          <details className={styles.details}>
            <summary>
              City checks <span>{warnings.length ? `${warnings.length} to review` : 'All clear'}</span>
            </summary>
            {warnings.length ? (
              <ul className={styles.list}>
                {warnings.map((w, i) => (
                  <li key={i} className={styles.hint}>
                    {w}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.hint}>Every building has road access and the network is connected.</p>
            )}
          </details>
          <p className={styles.hint}>
            <kbd>1</kbd>–<kbd>9</kbd> pick from the hotbar, <kbd>[</kbd> <kbd>]</kbd> brush size. Right-drag still orbits while building.
          </p>
        </>
      )}
    </Flyout>
  );
}

export function TerrainTool({ onClose, onBranch }: { onClose: () => void; onBranch: () => void }) {
  const state = useEditorStore();
  const locked = state.mode !== 'edit';
  return (
    <Flyout title="Terrain" subtitle="Shape the ground. Rain runs downhill and pools in every hollow you make." onClose={onClose}>
      {locked ? (
        <Locked onBranch={onBranch} />
      ) : (
        <>
          <Segmented
            label="Terrain tool"
            value={state.tool === 'lower' ? 'lower' : 'raise'}
            onChange={(v) => useEditorStore.setState({ tool: v, preview: [] })}
            options={[
              { id: 'raise', label: <><ArrowUpToLine size={14} /> Raise</> },
              { id: 'lower', label: <><ArrowDownToLine size={14} /> Lower</> },
            ]}
          />
          <Stepper label="Height per stroke (m)" value={state.heightAmount} min={1} max={10} onChange={(v) => useEditorStore.setState({ heightAmount: v })} />
          <Slider label="Brush" value={state.brush} display={`${state.brush * 4} m`} min={1} max={9} step={2} onChange={(v) => useEditorStore.setState({ brush: v })} />
          <UndoRow />
          <p className={styles.hint}>
            A raised bank keeps the river out; a lowered underpass collects rain. Digging a hollow in a park makes a retention pond that stores rain before it reaches homes. Run the storm again to see how water moves on the new ground.
          </p>
        </>
      )}
    </Flyout>
  );
}

export function Hotbar() {
  const { hotbar, slot, pickSlot } = useEditorStore();
  return (
    <nav className={`${styles.panel} ${styles.hotbar}`} aria-label="Block hotbar">
      {hotbar.map((b, i) => (
        <button key={i} type="button" aria-pressed={i === slot} aria-label={`Slot ${i + 1}: ${BLOCK_META[b].name}`} title={`${i + 1} · ${blockTip(b)}`} onClick={() => pickSlot(i)}>
          <small>{i + 1}</small>
          <span style={{ background: blockColor(b) }} />
        </button>
      ))}
    </nav>
  );
}
