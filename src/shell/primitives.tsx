'use client';

import { Minus, Plus, X } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './shell.module.css';

export function Flyout({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`${styles.panel} ${styles.flyout} ${wide ? styles.flyoutWide : ''}`} aria-label={title}>
      <header className={styles.flyoutHead}>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </header>
      <div className={styles.flyoutBody}>{children}</div>
    </section>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <div className={styles.toggleRow}>
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={styles.switch} onClick={onChange} />
    </div>
  );
}

export function Stepper({ label, value, min, max, step = 1, disabled, onChange }: { label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <div className={styles.stepper}>
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - step))}>
          <Minus size={13} />
        </button>
        <output>{value}</output>
        <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + step))}>
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

export function Slider({ label, value, display, min, max, step, disabled, help, onChange }: { label: string; value: number; display: string; min: number; max: number; step: number; disabled?: boolean; help?: string; onChange: (v: number) => void }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldHead}>
        {label}
        <output>{display}</output>
      </span>
      <input className={styles.range} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} />
      {help && <small>{help}</small>}
    </label>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label, disabled }: { value: T; options: { id: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} type="button" title={o.title} aria-pressed={o.id === value} disabled={disabled} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
