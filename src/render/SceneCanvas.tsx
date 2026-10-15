'use client';

import { useEffect, useRef } from 'react';
import type { SimBridge } from '../bridge/SimBridge';
import { SceneRenderer } from './SceneRenderer';

/** Client-only mount point for the three.js scene. */
export function SceneCanvas({ bridge }: { bridge: SimBridge }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scene = new SceneRenderer(el, bridge);
    return () => scene.dispose();
  }, [bridge]);

  return <div ref={ref} className="absolute inset-0" aria-label="3D city view" role="img" />;
}
