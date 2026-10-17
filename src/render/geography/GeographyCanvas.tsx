'use client';

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { Scenario } from '../../contracts';
import type { DistrictPlace } from '../../editor/geography/sixMile';
import { GeographyRenderer, type ScreenAnchor } from './GeographyRenderer';

export interface GeographyControls {
  focus: (x: number, z: number) => void;
  flyInto: (x: number, z: number, zoomTo?: number, durationMs?: number) => Promise<void>;
  zoom: (factor: number) => void;
  reset: () => void;
}

export function GeographyCanvas({ scenario, places, selected, onAnchors, onSelect, onError, controlsRef }: {
  scenario: Scenario | null;
  places: DistrictPlace[];
  selected: number | null;
  onAnchors: (anchors: ScreenAnchor[]) => void;
  onSelect: (id: number) => void;
  onError: (message: string) => void;
  controlsRef: Ref<GeographyControls>;
}) {
  const element = useRef<HTMLDivElement>(null);
  const renderer = useRef<GeographyRenderer | null>(null);
  useImperativeHandle(controlsRef, () => ({
    focus: (x, z) => renderer.current?.focus(x, z),
    flyInto: (x, z, zoomTo, durationMs) => renderer.current?.flyInto(x, z, zoomTo, durationMs) ?? Promise.resolve(),
    zoom: factor => renderer.current?.zoom(factor),
    reset: () => renderer.current?.reset(),
  }), []);
  useEffect(() => {
    if (!element.current) return;
    try {
      const scene = new GeographyRenderer(element.current, scenario, places, onAnchors, onSelect);
      renderer.current = scene;
      return () => { renderer.current = null; scene.dispose(); };
    } catch {
      onError('The 3D map could not start on this device. You can still choose a district below or download its city file.');
    }
  }, [scenario, places, onAnchors, onSelect, onError]);
  useEffect(() => { renderer.current?.select(selected); }, [selected]);
  return <div ref={element} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} role="img"
    aria-label={scenario ? 'Explorable 2.5D Six Mile district: diagonal arterial, winding channel, connected lanes, hospital and power campus.' : 'Illustrative 2.5D Guwahati overview: Brahmaputra to the north, Deepor Bil to the west and hills along the south and east.'} />;
}
