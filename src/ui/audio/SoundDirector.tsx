'use client';

import { Volume2, VolumeX } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { useSceneStore } from '../../bridge/sceneStore';
import { useSimFeedStore } from '../../bridge/simFeedStore';
import type { SimEventType } from '../../contracts';
import { daylightAt } from '../../render/effects/daylight';
import { strikesBetween } from '../../render/effects/lightning';
import { useEditorStore } from '../store/editorStore';
import { sound, type Cue } from './engine';

const TICK_MS = 250;
const HELI_EVENTS = new Set<SimEventType>(['HELI_DISPATCH', 'HELI_PICKUP', 'HELI_DROPOFF', 'MEDEVAC', 'ROOFTOP_RESCUE']);
const HELI_AIRBORNE_TICKS = 420;
const EVENT_CUES: Partial<Record<SimEventType, Cue>> = {
  POWER_TRIP: 'powerDown',
  POWER_RESTORED: 'powerUp',
  ASSIGNED: 'siren',
  HELI_DISPATCH: 'siren',
  AMBULANCE_DISPATCH: 'siren',
  TEAMS_DEPLOYED: 'horn',
  LEVEE_BREACH: 'thunder',
  LANDSLIDE: 'thunder',
};

/** Drives the sound engine from the run. Mount once; renders nothing. */
export function SoundDirector() {
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    const heliSeen = new Map<number, number>();
    let seen = useSimFeedStore.getState().events.length;
    const offFeed = useSimFeedStore.subscribe((s) => {
      if (s.events.length < seen) {
        seen = 0;
        heliSeen.clear();
      }
      const fresh = s.events.slice(seen);
      seen = s.events.length;
      const live = fresh.length < 200 && useSceneStore.getState().playing;
      for (const e of fresh) {
        if (HELI_EVENTS.has(e.type) && e.actor !== undefined && e.actorKind === 'vehicle') heliSeen.set(e.actor, e.tick);
        const cue = EVENT_CUES[e.type];
        if (cue && live) sound.cue(cue);
      }
    });

    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const scene = useSceneStore.getState();
      const running = scene.playing && useEditorStore.getState().mode === 'run';
      if (!running) {
        sound.setAmbience({ rain: 0, wind: 0, city: useEditorStore.getState().mode === 'edit' ? 0.4 : 0.2, helicopters: 0 });
        last = now;
        return;
      }
      const { rain, wind } = scene.weather;
      const day = daylightAt(scene.startSeconds + scene.tick).day;
      const frame = useSimFeedStore.getState().metrics.at(-1);
      const dark = (frame?.unpoweredPopPct ?? 0) / 100;
      let helicopters = 0;
      heliSeen.forEach((t) => (helicopters += scene.tick - t < HELI_AIRBORNE_TICKS ? 1 : 0));
      sound.setAmbience({ rain, wind, city: (0.45 + 0.55 * day) * (1 - 0.6 * dark), helicopters });
      for (const s of strikesBetween(last, now, rain)) {
        const delay = Math.max(0, s.at - now) + 250 + (1 - s.power) * 2200;
        setTimeout(() => sound.cue('thunder', s.power), delay);
      }
      last = now;
    }, TICK_MS);

    return () => {
      offFeed();
      clearInterval(timer);
    };
  }, []);

  return null;
}

const subscribe = (fn: () => void) => sound.subscribe(fn);

/** Mute toggle; starts the audio on first press if needed. */
export function SoundToggle({ className }: { className?: string }) {
  const muted = useSyncExternalStore(
    subscribe,
    () => sound.muted,
    () => false,
  );
  return (
    <button
      type="button"
      className={className}
      aria-pressed={!muted}
      aria-label={muted ? 'Turn sound on' : 'Mute sound'}
      title={muted ? 'Sound off' : 'Sound on: rain, thunder, sirens, helicopters, news'}
      onClick={() => {
        sound.unlock();
        sound.setMuted(!muted);
      }}
    >
      {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
    </button>
  );
}
