'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, Check, Compass, Crosshair, Layers, MapPin, Minus, Plus, Waves } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { createSixMile } from '../../editor/geography/sixMile';
import { CITY_ANCHORS } from '../../render/geography/GeographyRenderer';
import { GeographyCanvas, type GeographyControls } from '../../render/geography/GeographyCanvas';
import type { ScreenAnchor } from '../../render/geography/GeographyRenderer';
import { armCloudEnter, CloudWipe } from './CloudWipe';
import styles from './geography.module.css';

const EMPTY_PLACES: ReturnType<typeof createSixMile>['places'] = [];

const HOTSPOTS = [
  { id: 'six-mile', name: 'Six Mile', area: 'Southeast Guwahati', ready: true, href: '/six-mile/simulate' },
  { id: 'paltan', name: 'Paltan Bazaar', area: 'Central Guwahati', ready: false, href: null },
  { id: 'biswanath', name: 'Biswanath Town', area: 'Regional · Assam', ready: false, href: null },
] as const;

export function GeographyApp({ district = false }: { district?: boolean }) {
  const router = useRouter();
  const model = useMemo(() => district ? createSixMile() : null, [district]);
  const [selected, setSelected] = useState<number | null>(null);
  const [activePin, setActivePin] = useState<string | null>(null);
  const [anchors, setAnchors] = useState<ScreenAnchor[]>([]);
  const [labels, setLabels] = useState(true);
  const [error, setError] = useState('');
  const [transitioning, setTransitioning] = useState(false);
  const [wipe, setWipe] = useState<'idle' | 'covering' | 'holding'>('idle');
  const [notice, setNotice] = useState('');
  const controls = useRef<GeographyControls>(null);
  const pendingHref = useRef<string | null>(null);
  const select = useCallback((id: number) => setSelected(id), []);
  const mapError = useCallback((message: string) => setError(message), []);
  const place = model?.places.find(p => p.id === selected);

  const choosePlace = (id: number) => {
    const p = model?.places.find(p => p.id === id);
    setSelected(id);
    if (p) controls.current?.focus(p.x, p.z);
  };

  const openHotspot = async (id: string) => {
    if (transitioning) return;
    const hotspot = HOTSPOTS.find(h => h.id === id);
    const anchor = CITY_ANCHORS.find(a => a.id === id);
    if (!hotspot || !anchor) return;
    setActivePin(id);
    setNotice('');
    setTransitioning(true);
    // Soft lean toward the pin while clouds gather — the wipe does the real handoff.
    void controls.current?.flyInto(anchor.x, anchor.z, hotspot.ready ? 2.4 : 2.2);
    if (hotspot.ready && hotspot.href) {
      pendingHref.current = hotspot.href;
      armCloudEnter(hotspot.href);
      setWipe('covering');
      return;
    }
    await new Promise(r => setTimeout(r, 700));
    setNotice(`${hotspot.name} is a location preview — a full district model is planned next.`);
    setTransitioning(false);
  };

  const onCovered = useCallback(() => {
    setWipe('holding');
    const href = pendingHref.current;
    if (href) router.push(href);
  }, [router]);

  return <main className={`${styles.app} ${district ? styles.districtApp : styles.atlasApp}`}>
    <CloudWipe phase={wipe} onCovered={onCovered} />
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="FloodSim city atlas home">
        <span className={styles.brandIcon}><Waves size={21} /></span>
        <strong>flood<span>sim</span></strong>
        <span className={styles.brandDivider} />
        <span className={styles.brandSuffix}>{district ? 'SIX MILE' : 'CITY ATLAS'}</span>
      </Link>
      <nav aria-label="City navigation" className={styles.headerNav}>
        {district
          ? <Link href="/"><ArrowLeft size={14} /> Assam overview</Link>
          : <span className={styles.region}><span /> ASSAM · GUWAHATI</span>}
        <Link href="/sandbox" prefetch={false} className={styles.sandboxLink}>Test sandbox <ArrowUpRight size={14} /></Link>
      </nav>
    </header>

    <section className={styles.map} aria-label={district ? 'Six Mile interactive map' : 'Assam and Guwahati interactive map'}>
      <GeographyCanvas scenario={model?.scenario ?? null} places={model?.places ?? EMPTY_PLACES} selected={selected}
        onAnchors={setAnchors} onSelect={select} onError={mapError} controlsRef={controls} />
      {!error && anchors.length === 0 && <div className={styles.mapLoading} role="status"><Compass size={20} /> Building the map…</div>}

      <div className={styles.mapTop}>
        <div className={styles.breadcrumb}>
          <MapPin size={14} />
          <span>Assam</span>
          <span className={styles.crumbSep}>/</span>
          <strong>Guwahati</strong>
          {district && <><span className={styles.crumbSep}>/</span><strong>Six Mile</strong></>}
        </div>
        <button type="button" className={styles.labelToggle} aria-pressed={labels} onClick={() => setLabels(!labels)}>
          <Layers size={14} /> Labels {labels && <Check size={12} />}
        </button>
      </div>

      {error ? <div className={styles.mapError} role="alert"><Compass size={26} /><strong>Explore by location</strong><p>{error}</p></div> : <div className={styles.annotations}>
        {labels && anchors.filter(a => a.visible).map(a => a.kind === 'place' ? <button type="button" key={a.id}
          className={`${styles.pin} ${district ? styles.districtPin : styles.hotspotPin} ${!district && activePin === a.id ? styles.pinActive : ''}`}
          style={{ left: a.left, top: a.top }}
          aria-pressed={district ? selected === Number(a.id) : activePin === a.id}
          disabled={transitioning}
          onClick={() => district ? choosePlace(Number(a.id)) : void openHotspot(a.id)}>
          <span className={styles.pinMarker}><MapPin size={district ? 12 : 15} fill="currentColor" /></span>
          <span>{a.text}</span>
          {!district && <small>{HOTSPOTS.find(h => h.id === a.id)?.ready ? 'ENTER DISTRICT' : 'PREVIEW'}</small>}
        </button> : <span key={a.id} className={a.kind === 'water' ? styles.waterLabel : styles.areaLabel} style={{ left: a.left, top: a.top }}>{a.text}</span>)}
      </div>}

      <div className={styles.mapControls} aria-label="Map controls">
        <span className={styles.north}>N<Compass size={21} /></span>
        <button type="button" onClick={() => controls.current?.zoom(1.3)} aria-label="Zoom in"><Plus size={17} /></button>
        <button type="button" onClick={() => controls.current?.zoom(1 / 1.3)} aria-label="Zoom out"><Minus size={17} /></button>
        <button type="button" onClick={() => controls.current?.reset()} aria-label="Reset map view"><Crosshair size={17} /></button>
      </div>

      {!district && <p className={styles.atlasHint}>Three demonstration hotspots · pick a pin to fly in</p>}
      {district && place && <article className={styles.districtChip} aria-live="polite">
        <strong>{place.name}</strong>
        <span>{place.source === 'reference' ? 'From your reference' : 'Illustrative structure'}</span>
        <Link className={styles.primary} href="/six-mile/simulate" prefetch={false}
          onClick={(e) => {
            e.preventDefault();
            setTransitioning(true);
            pendingHref.current = '/six-mile/simulate';
            armCloudEnter('/six-mile/simulate');
            setWipe('covering');
          }}>Open simulator <ArrowUpRight size={15} /></Link>
      </article>}
      {district && !place && <button type="button" className={styles.simLaunch}
        onClick={() => {
          setTransitioning(true);
          pendingHref.current = '/six-mile/simulate';
          armCloudEnter('/six-mile/simulate');
          setWipe('covering');
        }}>Open in simulator <ArrowUpRight size={15} /></button>}

      {notice && <div className={styles.notice} role="status">{notice}<button type="button" onClick={() => setNotice('')}>Dismiss</button></div>}
      <footer className={styles.mapFooter}><span>Simulation output; not an emergency-planning authority</span></footer>
    </section>
  </main>;
}
