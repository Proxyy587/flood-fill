import type { SimEvent, SimEventType } from '../../contracts';

export interface Incident {
  tick: number;
  type: SimEventType;
  title: string;
  detail: string;
  score: number;
  event: SimEvent;
  /** Other events of the same type folded into this one. */
  more: number;
}

const WEIGHT: Partial<Record<SimEventType, { score: number; title: string }>> = {
  INVARIANT_VIOLATION: { score: 100, title: 'A safety rule was broken' },
  POWER_TRIP: { score: 90, title: 'A substation tripped' },
  GENERATOR_EXHAUSTED: { score: 85, title: 'A hospital lost all power' },
  BRIDGE_OVERTOPPED: { score: 80, title: 'A bridge went under water' },
  HOSPITAL_DIVERSION_ON: { score: 75, title: 'A hospital started diverting patients' },
  SHELTER_OVERFLOW: { score: 70, title: 'A shelter overflowed' },
  ROOFTOP_RESCUE: { score: 62, title: 'Critical rooftop airlift' },
  HELI_GROUNDED_WIND: { score: 55, title: 'Helicopters grounded by wind' },
  EVAC_ORDER: { score: 50, title: 'Evacuation ordered' },
  GRIDLOCK: { score: 45, title: 'Traffic gridlocked' },
};

/**
 * The run's five most important incidents, from fixed templates (no language model).
 * Repeats of a type fold into its first occurrence; the slowest rescue is always considered.
 */
export function topIncidents(events: readonly SimEvent[], limit = 5): Incident[] {
  const byType = new Map<SimEventType, Incident>();
  for (const e of events) {
    const w = WEIGHT[e.type];
    if (!w) continue;
    const prev = byType.get(e.type);
    if (prev) {
      prev.more++;
      continue;
    }
    const bonus = e.type === 'POWER_TRIP' ? Math.min(9, events.filter((b) => b.type === 'BLACKOUT_ZONE' && b.actor === e.actor).reduce((s, b) => s + (typeof b.data?.cells === 'number' ? b.data.cells / 500 : 0), 0)) : 0;
    byType.set(e.type, { tick: e.tick, type: e.type, title: w.title, detail: e.reason, score: w.score + bonus, event: e, more: 0 });
  }
  const slowest = events.filter((e) => e.type === 'SERVED' && typeof e.data?.tts === 'number').sort((a, b) => Number(b.data?.tts) - Number(a.data?.tts))[0];
  const list = [...byType.values()];
  if (slowest && Number(slowest.data?.tts) >= 300) list.push({ tick: slowest.tick, type: 'SERVED', title: 'Longest wait for help', detail: slowest.reason, score: 65, event: slowest, more: 0 });
  return list
    .map((i) => (i.more ? { ...i, detail: `${i.detail} (and ${i.more} more like it)` } : i))
    .sort((a, b) => b.score - a.score || a.tick - b.tick)
    .slice(0, limit);
}
