'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSceneStore } from '../../bridge/sceneStore';
import { AUTOSAVE_KEY } from '../../editor/autosave';
import { createSixMile } from '../../editor/geography/sixMile';
import { citySlot } from '../../editor/persistence';
import { useEditorStore } from '../../ui/store/editorStore';
import { FloodSimApp } from '../FloodSimApp';
import { CloudWipe, peekCloudEnter, takeCloudEnter, type WipePhase } from './CloudWipe';
import styles from './geography.module.css';

/** Additive adapter: waits for the shell's initial worker handshake, then loads the district. */
export function SixMileSimulation() {
  const loaded = useRef(false);
  const entering = useRef(false);
  const [wipe, setWipe] = useState<WipePhase>('idle');

  useEffect(() => {
    if (peekCloudEnter()) {
      entering.current = true;
      takeCloudEnter();
      // Defer past paint so we don't sync-set in the effect body.
      const hold = window.setTimeout(() => setWipe('holding'), 0);
      return () => window.clearTimeout(hold);
    }
  }, []);

  useEffect(() => {
    loaded.current = false;
    useSceneStore.getState().setRunSettings({ engine: 'preview' });
    const apply = () => {
      const { scenario } = createSixMile();
      const params = useEditorStore.getState().params;
      useEditorStore.getState().load(scenario);
      void citySlot('write', AUTOSAVE_KEY, { scenario, params }).catch(() => {});
    };
    const load = () => {
      if (useSceneStore.getState().connection !== 'ready') return;
      if (!loaded.current) {
        loaded.current = true;
        apply();
      }
    };
    const off = useSceneStore.subscribe(load);
    load();
    const retry = window.setTimeout(apply, 450);
    return () => {
      off();
      window.clearTimeout(retry);
    };
  }, []);

  useEffect(() => {
    if (wipe !== 'holding') return;
    let done = false;
    const tryReveal = () => {
      if (done) return;
      const st = useSceneStore.getState();
      const city = useEditorStore.getState().scenario?.name ?? '';
      if (st.connection !== 'ready' || !city.includes('Six Mile')) return;
      done = true;
      entering.current = false;
      // Brief hold so the 3D city paints under the clouds before they peel away.
      window.setTimeout(() => setWipe('revealing'), 700);
    };
    tryReveal();
    const offScene = useSceneStore.subscribe(tryReveal);
    const offEditor = useEditorStore.subscribe(tryReveal);
    return () => { offScene(); offEditor(); };
  }, [wipe]);

  const onRevealed = useCallback(() => setWipe('idle'), []);

  return <>
    <CloudWipe phase={wipe} onRevealed={onRevealed} />
    <FloodSimApp />
    <Link href="/" className={styles.returnLink}><ArrowLeft size={13} /> Assam overview</Link>
  </>;
}
