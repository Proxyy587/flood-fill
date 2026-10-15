import type { MetricsFrame, SimEvent } from '../../contracts';

export type NewsKind = 'breaking' | 'update' | 'official' | 'social';
export type NewsTone = 'info' | 'warn' | 'bad' | 'good';

export interface NewsItem {
  /** Stable across recomputation, for React keys and "seen" tracking. */
  key: string;
  tick: number;
  kind: NewsKind;
  /** Synthetic outlet or social handle. */
  source: string;
  headline: string;
  body?: string;
  cell?: number;
  tone: NewsTone;
}

export interface NewsContext {
  city: string;
  districtAt: (cell: number) => string | undefined;
  buildingName: (id: number) => string | undefined;
}

/** Fictional outlets; nothing here quotes a real organisation's feed. */
export const OUTLETS = {
  tv: 'City Live 24',
  paper: 'The Daily Ledger',
  weather: 'Weather Desk',
  control: 'District Control Room',
} as const;

const HANDLES = ['@ward7_rahul', '@riverside_mum', '@chai_corner', '@night_shift_nurse', '@bus_driver_ali', '@college_hostel', '@auto_anna', '@market_street', '@old_town_aunty', '@cyclist_meera'];

const RESCUE_WINDOW = 600;
const SOCIAL_GAP = 180;
const MILESTONES = { unpowered: [25, 50, 75], homes: [25, 100, 250, 500], evac: [50, 90] } as const;

const hash = (a: number, b: number): number => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};
const pick = <T>(list: readonly T[], tick: number, salt: number): T => list[hash(tick, salt) % list.length];
const typeSalt = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const num = (e: SimEvent, k: string): number | undefined => (typeof e.data?.[k] === 'number' ? (e.data[k] as number) : undefined);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Turns the run's event log and metrics into a newsroom feed: breaking TV
 * headlines, official notices, newspaper updates and resident posts.
 * Deterministic: the same run always produces the same feed.
 */
export function buildNews(events: readonly SimEvent[], metrics: readonly MetricsFrame[], ctx: NewsContext): NewsItem[] {
  const out: NewsItem[] = [];
  const place = (e: SimEvent) => (e.cell !== undefined ? ctx.districtAt(e.cell) : undefined) ?? ctx.city;
  const actorName = (e: SimEvent) => (e.actorKind === 'building' && e.actor !== undefined ? ctx.buildingName(e.actor) : undefined);
  const lastSocial = new Map<string, number>();
  const once = new Set<string>();
  let rescued = 0;
  let rescueWindow = 0;
  let stranded = 0;
  let powerCuts = 0;

  const seen = new Set<string>();
  const push = (e: SimEvent | { tick: number; cell?: number }, kind: NewsKind, source: string, headline: string, tone: NewsTone, body?: string) => {
    const key = `${e.tick}|${source}|${headline}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, tick: e.tick, kind, source, headline, body, cell: e.cell, tone });
  };

  const social = (e: SimEvent, topic: string, lines: readonly string[]) => {
    const prev = lastSocial.get(topic);
    if (prev !== undefined && e.tick - prev < SOCIAL_GAP) return;
    lastSocial.set(topic, e.tick);
    push(e, 'social', pick(HANDLES, e.tick, typeSalt(topic)), pick(lines, e.tick, typeSalt(topic) + 1), 'info');
  };

  const flushRescues = (tick: number) => {
    if (rescued > 0) {
      push({ tick }, 'update', OUTLETS.paper, `${plural(rescued, 'person', 'people')} brought to safety in the last ${RESCUE_WINDOW / 60} minutes`, 'good', 'Boat crews and helicopters are working through calls street by street.');
    }
    rescued = 0;
  };

  for (const e of events) {
    while (e.tick >= (rescueWindow + 1) * RESCUE_WINDOW) {
      flushRescues((rescueWindow + 1) * RESCUE_WINDOW);
      rescueWindow++;
    }
    const where = place(e);
    switch (e.type) {
      case 'WEATHER': {
        const rain = num(e, 'rain') ?? 0;
        if (rain >= 0.7) {
          push(e, 'breaking', OUTLETS.tv, pick([`Torrential rain lashes ${ctx.city}`, `Red alert: extreme rain over ${ctx.city}`, `Cloudburst conditions over ${ctx.city}`], e.tick, 1), 'bad', 'Residents in low-lying wards are urged to move valuables upstairs and stay off flooded roads.');
          social(e, 'rain', ['Never seen rain like this. Street is a river already.', 'Rain so loud I cannot hear the TV. Stay safe everyone.', 'Office let us go early. Roads already filling up.']);
        } else if (rain >= 0.3) push(e, 'update', OUTLETS.weather, `Moderate rain over ${ctx.city}; heavier bands expected`, 'warn');
        else push(e, 'update', OUTLETS.weather, `Rain easing over ${ctx.city}`, 'good', 'Water will take time to drain from low ground.');
        break;
      }
      case 'FLOOD_THRESHOLD':
        push(e, 'breaking', OUTLETS.tv, `${num(e, 'pct') ?? '?'}% of ${ctx.city} under water`, 'bad', e.reason);
        break;
      case 'LOCAL_FLOOD':
        push(e, 'update', OUTLETS.paper, `Streets flooding in ${where}`, 'warn', e.reason);
        social(e, `pond:${where}`, [`Knee-deep water on the main road in ${where}. Do not drive this way.`, `Our lane in ${where} is completely waterlogged.`, `Drains in ${where} are overflowing again. Every monsoon.`]);
        break;
      case 'DRAIN_BACKFLOW':
        push(e, 'update', OUTLETS.paper, `Drains back up in ${where} as river rises`, 'warn', 'With the river above the outfalls, storm drains push water back into the streets until the pumps get power.');
        break;
      case 'HOMES_FLOODED': {
        push(e, 'update', OUTLETS.paper, `Water enters homes in ${where}`, 'bad', e.reason);
        social(e, `homes:${where}`, [`Water just came in through the front door. Moving everything upstairs.`, `Our ground floor in ${where} is gone. We are on the terrace.`, `Help, my parents are stuck in ${where}, ground floor flooded.`]);
        break;
      }
      case 'BRIDGE_OVERTOPPED':
        push(e, 'breaking', OUTLETS.tv, `Bridge closed in ${where} as river tops the deck`, 'bad', 'Traffic is being turned back; crossings elsewhere are expected to jam.');
        break;
      case 'ROAD_CLOSED':
        if (!once.has('road')) {
          once.add('road');
          push(e, 'official', OUTLETS.control, 'Police close first roads to traffic', 'warn', 'Avoid underpasses and low roads. Do not drive through flood water.');
        }
        break;
      case 'EVAC_ORDER':
        push(e, 'official', OUTLETS.control, 'Evacuation ordered for low-lying wards', 'warn', `${e.reason}. Go to the nearest relief shelter on foot if roads are closed.`);
        break;
      case 'POWER_TRIP': {
        powerCuts++;
        const name = actorName(e) ?? 'a substation';
        push(e, powerCuts === 1 ? 'breaking' : 'update', powerCuts === 1 ? OUTLETS.tv : OUTLETS.paper, `Power cut in ${where} after flooding at ${name}`, 'bad', 'Traffic lights and drain pumps in the area are down.');
        social(e, `power:${where}`, ['Lights just went out across the whole block.', `Power gone in ${where}. Phone on 20%, anyone know how long?`, 'Total blackout here. Only candles and the sound of rain.']);
        break;
      }
      case 'POWER_RESTORED':
        push(e, 'update', OUTLETS.paper, `Power back in ${where}`, 'good', e.reason);
        break;
      case 'SIGNAL_DARK':
        social(e, 'signals', ['Signals are dead at the junction. Everyone is just honking.', 'No traffic lights anywhere. Took 20 minutes to cross one junction.']);
        break;
      case 'GENERATOR_START':
        push(e, 'update', OUTLETS.paper, `${actorName(e) ?? 'Hospital'} running on backup generator`, 'warn');
        break;
      case 'GENERATOR_EXHAUSTED':
        push(e, 'breaking', OUTLETS.tv, `${actorName(e) ?? 'A hospital'} loses all power`, 'bad', 'Patients are being diverted to other hospitals.');
        break;
      case 'HOSPITAL_DIVERSION_ON':
        push(e, 'official', OUTLETS.control, `${actorName(e) ?? 'A hospital'} is diverting new patients`, 'bad');
        break;
      case 'SHELTER_OVERFLOW':
        push(e, 'update', OUTLETS.paper, `${actorName(e) ?? 'A relief shelter'} is full`, 'bad', 'Evacuees are being sent on to the next shelter.');
        social(e, 'shelter', ['Shelter is packed, they are sending people to the next school.', 'No space left at the relief camp. Where do we go?']);
        break;
      case 'GRIDLOCK':
        push(e, 'update', OUTLETS.paper, `Gridlock in ${where}`, 'warn', e.reason);
        social(e, `jam:${where}`, ['Stuck in the same spot for half an hour.', `${where} is one giant traffic jam. Avoid.`, 'Ambulance stuck behind us and nobody can move.']);
        break;
      case 'HELI_GROUNDED_WIND':
        if (!once.has(`wind:${Math.floor(e.tick / 600)}`)) {
          once.add(`wind:${Math.floor(e.tick / 600)}`);
          push(e, 'update', OUTLETS.weather, 'High winds ground rescue helicopters', 'warn');
        }
        break;
      case 'TEAMS_DEPLOYED': {
        const teams = num(e, 'teams') ?? 1;
        push(e, 'official', OUTLETS.control, `${plural(teams, 'SDRF boat team')} released into the city`, 'good', e.reason);
        push(e, 'breaking', OUTLETS.tv, `Rescue boats on the water in ${where}`, 'good');
        social(e, 'teams', ['Boats just went past our street. Thank you, rescue teams.', 'Orange life jackets everywhere. Help is here.', 'Rescue boat picked up our neighbours. Waiting for our turn.']);
        break;
      }
      case 'NPC_STRANDED':
        stranded++;
        social(e, 'stranded', [`Stuck on the roof with my kids in ${where}. Please send help.`, `Water up to the chest outside. Cannot get out in ${where}.`, `Old man on the first floor next door cannot walk out. ${where}.`]);
        if (stranded === 10) push(e, 'breaking', OUTLETS.tv, `Dozens trapped by rising water in ${ctx.city}`, 'bad', 'Rescue control is prioritising rooftops and the elderly.');
        break;
      case 'ROOFTOP_RESCUE':
        rescued++;
        social(e, 'heli', ['Helicopter just winched someone off the roof across the road.', 'Chopper hovering over our colony. They are getting people out.']);
        break;
      case 'SERVED':
        rescued++;
        break;
      case 'INJECTED':
        push(e, 'breaking', OUTLETS.tv, e.reason.replace(/\s*\(injected\)$/, '').replace(/^./, (c) => c.toUpperCase()), 'warn');
        break;
      default:
        break;
    }
  }

  const passed = { unpowered: 0, homes: 0, evac: 0 };
  for (const f of metrics) {
    while (passed.unpowered < MILESTONES.unpowered.length && f.unpoweredPopPct >= MILESTONES.unpowered[passed.unpowered]) {
      const pct = MILESTONES.unpowered[passed.unpowered++];
      push(f, 'breaking', OUTLETS.tv, pct >= 50 ? `${pct}% of ${ctx.city} in the dark` : `A quarter of ${ctx.city} without power`, 'bad');
    }
    const homes = f.homesFlooded ?? 0;
    while (passed.homes < MILESTONES.homes.length && homes >= MILESTONES.homes[passed.homes]) {
      const n = MILESTONES.homes[passed.homes++];
      push(f, 'breaking', OUTLETS.tv, `${n}+ homes flooded across ${ctx.city}`, 'bad', `${f.residentsAffected ?? 0} residents affected so far.`);
    }
    while (passed.evac < MILESTONES.evac.length && f.evacDonePct >= MILESTONES.evac[passed.evac]) {
      const pct = MILESTONES.evac[passed.evac++];
      push(f, 'update', OUTLETS.paper, `${pct}% of evacuees reach shelter`, 'good');
    }
  }

  return out.sort((a, b) => a.tick - b.tick);
}
