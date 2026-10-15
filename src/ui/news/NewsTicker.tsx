'use client';

import { ChevronDown, ChevronUp, Megaphone, MessageCircle, Newspaper, Radio, Tv } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSceneStore } from '../../bridge/sceneStore';
import { useSimFeedStore } from '../../bridge/simFeedStore';
import { clockOf, useCityStore } from '../../shell/city';
import { sound } from '../audio/engine';
import { useEditorStore } from '../store/editorStore';
import { buildNews, OUTLETS, type NewsItem, type NewsKind } from './headlines';
import styles from './news.module.css';

const ROTATE_MS = 6000;
const BREAKING_MS = 9000;

const ICON: Record<NewsKind, typeof Tv> = { breaking: Tv, update: Newspaper, official: Megaphone, social: MessageCircle };
const LABEL: Record<NewsKind, string> = { breaking: 'Breaking', update: 'Update', official: 'Official', social: 'Residents' };

const prettyCity = (name: string) => name.split(' · ')[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** The run's news feed, recomputed as events arrive. */
export function useNews(): NewsItem[] {
  const scenario = useEditorStore((s) => s.scenario);
  const names = useCityStore((s) => s.names);
  const events = useSimFeedStore((s) => s.events);
  const metrics = useSimFeedStore((s) => s.metrics);
  const districtOf = useMemo(() => {
    const map = new Map<number, string>();
    scenario?.districts.forEach((d) => d.cells.forEach((c) => map.set(c, d.name)));
    return map;
  }, [scenario]);
  return useMemo(
    () =>
      scenario
        ? buildNews(events, metrics, {
            city: prettyCity(scenario.name),
            districtAt: (c) => districtOf.get(c),
            buildingName: (id) => names[id],
          })
        : [],
    [scenario, events, metrics, districtOf, names],
  );
}

const focusItem = (item: NewsItem) => {
  if (item.cell !== undefined) useSceneStore.getState().focus({ kind: 'cell', id: item.cell });
};

/** Live news strip above the transport bar, with an expandable feed. */
export function NewsTicker() {
  const items = useNews();
  const mode = useEditorStore((s) => s.mode);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [breaking, setBreaking] = useState<NewsItem | null>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!items.length) {
      seen.current = null;
      return;
    }
    if (!seen.current) {
      seen.current = new Set(items.map((i) => i.key));
      return;
    }
    const fresh = items.filter((i) => !seen.current?.has(i.key));
    fresh.forEach((i) => seen.current?.add(i.key));
    if (fresh.length > 30) return;
    const top = fresh.findLast((i) => i.kind === 'breaking');
    if (top) {
      setBreaking(top);
      sound.cue('news');
    } else if (fresh.some((i) => i.kind === 'official')) sound.cue('notice');
  }, [items]);

  useEffect(() => {
    if (!breaking) return;
    const t = setTimeout(() => setBreaking(null), BREAKING_MS);
    return () => clearTimeout(t);
  }, [breaking]);

  useEffect(() => {
    const t = setInterval(() => setIndex((i) => i + 1), ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  if (mode !== 'run' || !items.length) return null;
  const recent = items.slice(-6).reverse();
  const current = breaking ?? recent[index % recent.length];
  const Icon = ICON[current.kind];

  return (
    <section className={styles.wrap} aria-label="City news">
      {open && (
        <ol className={styles.feed} aria-label="News feed">
          {items
            .slice(-60)
            .reverse()
            .map((item) => {
              const ItemIcon = ICON[item.kind];
              return (
                <li key={item.key}>
                  <button type="button" onClick={() => focusItem(item)} disabled={item.cell === undefined} data-kind={item.kind} data-tone={item.tone}>
                    <ItemIcon size={14} aria-hidden />
                    <span>
                      <small>
                        {item.source} · {clockOf(item.tick)}
                      </small>
                      <b>{item.kind === 'social' ? `“${item.headline}”` : item.headline}</b>
                      {item.body && <em>{item.body}</em>}
                    </span>
                  </button>
                </li>
              );
            })}
        </ol>
      )}
      <div className={styles.ticker} data-breaking={breaking !== null}>
        <span className={styles.live}>
          <Radio size={13} aria-hidden />
          {breaking ? 'Breaking' : 'Live'}
        </span>
        <button key={current.key} type="button" className={styles.item} onClick={() => focusItem(current)} title={current.body ?? current.headline} data-tone={current.tone}>
          <Icon size={13} aria-hidden />
          <small>{current.kind === 'social' || current.kind === 'breaking' ? current.source : LABEL[current.kind]}</small>
          <b>{current.kind === 'social' ? `“${current.headline}”` : current.headline}</b>
          <time>{clockOf(current.tick)}</time>
        </button>
        <button type="button" className={styles.toggle} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Hide news feed' : 'Show news feed'} title={`${items.length} stories from ${OUTLETS.tv}, ${OUTLETS.paper}, ${OUTLETS.control} and residents`}>
          {items.length}
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
    </section>
  );
}
