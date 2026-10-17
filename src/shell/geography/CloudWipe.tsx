'use client';

import { useEffect } from 'react';
import styles from './cloudWipe.module.css';

export const CLOUD_ENTER_KEY = 'floodsim-cloud-enter';

export function armCloudEnter(href: string): void {
  try {
    sessionStorage.setItem(CLOUD_ENTER_KEY, href);
  } catch {
    /* private mode */
  }
}

export function peekCloudEnter(): boolean {
  try {
    return Boolean(sessionStorage.getItem(CLOUD_ENTER_KEY));
  } catch {
    return false;
  }
}

export function takeCloudEnter(): string | null {
  try {
    const v = sessionStorage.getItem(CLOUD_ENTER_KEY);
    if (v) sessionStorage.removeItem(CLOUD_ENTER_KEY);
    return v;
  } catch {
    return null;
  }
}

export type WipePhase = 'idle' | 'covering' | 'holding' | 'revealing';

/**
 * Full-screen Voronoi-cloud wipe. Cover before a route change, hold through
 * the navigation, then reveal so the page swap is invisible.
 */
export function CloudWipe({
  phase,
  onCovered,
  onRevealed,
}: {
  phase: WipePhase;
  onCovered?: () => void;
  onRevealed?: () => void;
}) {
  useEffect(() => {
    if (phase === 'covering') {
      // Cover fully before the route swap so the page change stays invisible.
      const t = window.setTimeout(() => onCovered?.(), 820);
      return () => window.clearTimeout(t);
    }
    if (phase === 'revealing') {
      const t = window.setTimeout(() => onRevealed?.(), 780);
      return () => window.clearTimeout(t);
    }
  }, [phase, onCovered, onRevealed]);

  if (phase === 'idle') return null;
  return (
    <div className={`${styles.wipe} ${styles[phase]}`} aria-hidden="true">
      <div className={styles.sheet} />
      <div className={`${styles.layer} ${styles.a}`} />
      <div className={`${styles.layer} ${styles.b}`} />
      <div className={`${styles.layer} ${styles.c}`} />
      <div className={styles.mist} />
    </div>
  );
}
