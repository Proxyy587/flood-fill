'use client';

import { useMemo, useState } from 'react';
import { BlockType } from '../../contracts';
import { BLOCK_META, CATEGORIES } from '../../editor/catalog';
import { cityWarnings } from '../../editor/validation';
import { BLOCK_VISUALS } from '../../render/palette';
import { TOOLS, useEditorStore } from '../store/editorStore';
import styles from '../hud/Sandbox.module.css';

export const blockColor = (b: BlockType) => `#${BLOCK_VISUALS[b].top.toString(16).padStart(6, '0')}`;

export function EditorPanel() {
  const state = useEditorStore(), [category, setCategory] = useState<typeof CATEGORIES[number]>('Roads');
  const warnings = useMemo(() => state.scenario ? cityWarnings(state.scenario) : [], [state.scenario]);
  const disabled = state.mode !== 'edit';
  const active = BLOCK_META[state.block];
  return <>
    <section className={styles.section}>
      <div className={styles.eyebrow}>City workbench</div>
      <h2>Small changes. Better resilience.</h2>
      <div className={styles.tools}>{TOOLS.map(t => <button key={t.id} disabled={disabled} aria-pressed={state.tool === t.id} onClick={() => useEditorStore.setState({ tool: t.id, preview: [], moveSource: null, powerSource: null })}><span aria-hidden>{t.icon}</span>{t.label}</button>)}</div>
      <label className={styles.label}><span>Brush width <output>{state.brush * 4} m</output></span><input aria-label="Brush size" type="range" min={1} max={9} step={2} value={state.brush} disabled={disabled} onChange={e => useEditorStore.setState({ brush: +e.target.value })}/></label>
      {(state.tool === 'raise' || state.tool === 'lower') && <label className={styles.label}>Height per stroke (m)<input type="number" min={1} max={10} value={state.heightAmount} onChange={e => useEditorStore.setState({ heightAmount: Math.max(1, Math.min(10, +e.target.value)) })}/></label>}
      <div className={styles.row}><button disabled={disabled || !state.past.length} onClick={state.undo} title="Ctrl/⌘ Z">↶ Undo</button><button disabled={disabled || !state.future.length} onClick={state.redo} title="Ctrl/⌘ Shift Z or Ctrl Y">↷ Redo</button></div>
    </section>
    <section className={styles.section}>
      <h2>Block library</h2>
      <label className={styles.label}>Category<select value={category} onChange={e => setCategory(e.target.value as typeof category)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
      <div className={styles.picker}>{Object.values(BLOCK_META).filter(m => m.category === category).map(m => <button key={m.type} disabled={disabled} aria-pressed={m.type === state.block} title={`${m.name} · ${m.footprint * 4} × ${m.footprint * 4} m. ${m.description}`} onClick={() => useEditorStore.setState(s => ({ block: m.type, tool: m.building ? 'building' : 'place', hotbar: s.hotbar.map((b,i) => i === s.slot ? m.type : b) }))}><span className={styles.swatch} style={{ background: blockColor(m.type) }}/>{m.name}</button>)}</div>
      <p><strong>{active.name}</strong> · {active.footprint * 4} × {active.footprint * 4} m</p>
      <p className={styles.muted}>{active.description}{active.building && ` Default capacity: ${active.capacity}.`}</p>
      <p className={styles.muted}>Choosing a block replaces the selected hotbar slot.</p>
    </section>
    <details className={`${styles.section} ${styles.details}`}><summary>City checks · {warnings.length} {warnings.length === 1 ? 'notice' : 'notices'}</summary>{warnings.length ? <ul className={styles.list}>{warnings.map((w,i) => <li key={i}>{w}</li>)}</ul> : <p className={styles.muted}>Access and connectivity checks passed.</p>}<p className={styles.muted}>Design warnings do not block a run.</p></details>
    <p className={styles.muted}>1–9 blocks · [ ] brush · Space play / pause · Esc overview. Right drag pans; wheel zooms. Drag with a tool to edit; Inspect restores orbit.</p>
  </>;
}

export function Hotbar() {
  const { hotbar, slot, pickSlot, mode } = useEditorStore();
  return <nav className={styles.hotbar} aria-label="Block hotbar">{hotbar.map((b,i) => <button key={i} disabled={mode !== 'edit'} aria-pressed={i === slot} aria-label={`Slot ${i+1}: ${BLOCK_META[b].name}`} title={`${i+1} · ${BLOCK_META[b].name}`} onClick={() => pickSlot(i)}><small>{i+1}</small><span className={styles.swatch} style={{background:blockColor(b)}}/></button>)}</nav>;
}
