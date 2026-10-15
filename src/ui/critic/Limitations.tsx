'use client';

import { LIMITATIONS } from '../../ai/schema';
import styles from '../dashboard/report.module.css';

/** Shown with every critic report and verification. */
export function Limitations({ extra = [] }: { extra?: readonly string[] }) {
  const items = [...new Set([...LIMITATIONS, ...extra])];
  return (
    <ul className={styles.limitations} aria-label="Limitations">
      {items.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}
