import * as THREE from 'three';
import type { SimEvent, WorldSnapshot } from '../../contracts';
import { beaconDetail, beaconTitle, cssColor, SHOWCASE_COLORS, showcaseOf, type ShowcaseEntry } from '../../ui/showcase/catalog';

/** How long a beacon stays on the map, wall-clock ms. */
const BEACON_MS = 24000;
/** How long its docked callout stays up. */
const CARD_MS = 7000;
const MAX_CARDS = 2;
const MAX_BEACONS = 24;
const BEAM_HEIGHT = 7;
const DROP_MS = 5200;

interface Beacon {
  x: number;
  z: number;
  born: number;
  group: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  halo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  card: HTMLButtonElement | null;
  crates: THREE.Group | null;
}

const ringGeometry = new THREE.RingGeometry(0.55, 0.72, 48).rotateX(-Math.PI / 2);
const haloGeometry = new THREE.RingGeometry(0.15, 1.6, 48).rotateX(-Math.PI / 2);
const beamGeometry = new THREE.CylinderGeometry(0.05, 0.12, 1, 10, 1, true).translate(0, 0.5, 0);
const crateGeometry = new THREE.BoxGeometry(0.22, 0.18, 0.22);
const chuteGeometry = new THREE.SphereGeometry(0.32, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const crateMaterial = new THREE.MeshLambertMaterial({ color: 0xc8a165 });
const chuteMaterial = new THREE.MeshLambertMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide });

/**
 * Map beacons (ripple + beam) plus a compact docked alert stack — not large
 * cards floating over the city.
 */
export class EventBeacons {
  readonly group = new THREE.Group();
  readonly root: HTMLDivElement;
  private dock: HTMLDivElement;
  private beacons: Beacon[] = [];
  private shown = new Map<string, { count: number; lastTick: number }>();
  private world: WorldSnapshot | null = null;

  constructor(private onPick: (cell: number) => void) {
    this.group.name = 'event-beacons';
    this.root = document.createElement('div');
    this.root.className = 'fs-beacons';
    this.dock = document.createElement('div');
    this.dock.className = 'fs-beacon-dock';
    this.dock.setAttribute('aria-label', 'Recent incidents');
    this.root.appendChild(this.dock);
  }

  setWorld(world: WorldSnapshot): void {
    this.world = world;
  }

  /** Clears everything (new run, seek backwards). */
  reset(): void {
    for (const b of this.beacons) this.drop(b);
    this.beacons = [];
    this.shown.clear();
  }

  /** Adds beacons for fresh events; `liveTick` filters out replayed history. */
  add(events: readonly SimEvent[], liveTick: number, now: number): void {
    const w = this.world;
    if (!w) return;
    for (const e of events) {
      if (e.cell === undefined || e.tick < liveTick - 90) continue;
      const entry = showcaseOf(e);
      if (!entry || !this.allow(entry, e)) continue;
      this.spawn(e, entry, (e.cell % w.w) + 0.5, Math.floor(e.cell / w.w) + 0.5, now);
    }
  }

  private allow(entry: ShowcaseEntry, e: SimEvent): boolean {
    const seen = this.shown.get(entry.id) ?? { count: 0, lastTick: -Infinity };
    const rule = entry.beacon;
    let ok = rule === 'always';
    if (typeof rule === 'object' && 'first' in rule) ok = seen.count < rule.first;
    if (typeof rule === 'object' && 'everyTicks' in rule) ok = e.tick - seen.lastTick >= rule.everyTicks;
    if (ok) this.shown.set(entry.id, { count: seen.count + 1, lastTick: e.tick });
    return ok;
  }

  private spawn(e: SimEvent, entry: ShowcaseEntry, x: number, z: number, now: number): void {
    const color = SHOWCASE_COLORS[entry.kind];
    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color } as const;
    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ ...additive, opacity: 0.8 }));
    const halo = new THREE.Mesh(haloGeometry, new THREE.MeshBasicMaterial({ ...additive, opacity: 0.25 }));
    const beam = new THREE.Mesh(beamGeometry, new THREE.MeshBasicMaterial({ ...additive, opacity: 0.32 }));
    beam.scale.set(1, BEAM_HEIGHT, 1);
    for (const m of [ring, halo, beam]) m.renderOrder = 6;
    const group = new THREE.Group();
    group.add(halo, ring, beam);
    group.position.set(x, 0, z);
    let crates: THREE.Group | null = null;
    if (e.type === 'FOOD_DROP') {
      crates = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const one = new THREE.Group();
        const crate = new THREE.Mesh(crateGeometry, crateMaterial);
        const chute = new THREE.Mesh(chuteGeometry, chuteMaterial);
        chute.position.y = 0.55;
        one.add(crate, chute);
        one.position.set(Math.cos(i * 1.9) * 0.9, 0, Math.sin(i * 1.9) * 0.9);
        one.userData.delay = i * 380;
        crates.add(one);
      }
      group.add(crates);
    }
    this.group.add(group);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'fs-beacon';
    card.style.setProperty('--c', cssColor(color));
    const kind = document.createElement('span');
    kind.className = 'fs-beacon-kind';
    kind.textContent = entry.label;
    const title = document.createElement('b');
    title.textContent = beaconTitle(e, entry);
    card.append(kind, title);
    const detail = beaconDetail(e);
    if (detail) {
      const line = document.createElement('span');
      line.className = 'fs-beacon-detail';
      line.textContent = detail;
      card.append(line);
    }
    const cell = e.cell as number;
    card.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.onPick(cell);
    });
    this.dock.prepend(card);

    this.beacons.push({ x, z, born: now, group, ring, halo, beam, card, crates });
    const carded = this.beacons.filter((b) => b.card);
    for (const b of carded.slice(0, Math.max(0, carded.length - MAX_CARDS))) this.retireCard(b);
    while (this.beacons.length > MAX_BEACONS) this.drop(this.beacons.shift() as Beacon);
  }

  private retireCard(b: Beacon): void {
    b.card?.remove();
    b.card = null;
  }

  private drop(b: Beacon): void {
    this.retireCard(b);
    this.group.remove(b.group);
    b.ring.material.dispose();
    b.halo.material.dispose();
    b.beam.material.dispose();
  }

  update(now: number, _camera: THREE.Camera, _width: number, _height: number, surfaceY: (x: number, z: number) => number): void {
    for (let i = this.beacons.length - 1; i >= 0; i--) {
      const b = this.beacons[i];
      const age = now - b.born;
      if (age > BEACON_MS) {
        this.drop(b);
        this.beacons.splice(i, 1);
        continue;
      }
      const fade = 1 - THREE.MathUtils.smoothstep(age, BEACON_MS * 0.55, BEACON_MS);
      const y = surfaceY(b.x, b.z) + 0.04;
      b.group.position.y = y;
      const t = (age % 2400) / 2400;
      b.ring.scale.setScalar(0.6 + t * 2.4);
      b.ring.material.opacity = 0.75 * (1 - t) * fade;
      b.halo.material.opacity = 0.22 * fade;
      b.beam.material.opacity = (0.22 + 0.1 * Math.sin(age / 700)) * fade;
      if (b.crates) {
        for (const one of b.crates.children) {
          const k = THREE.MathUtils.clamp((age - (one.userData.delay as number)) / DROP_MS, 0, 1);
          one.position.y = (1 - k * (2 - k)) * BEAM_HEIGHT * 0.8;
          one.visible = age > (one.userData.delay as number) && age < BEACON_MS * 0.7;
          const chute = one.children[1];
          chute.visible = k < 1;
        }
      }
      if (b.card) {
        if (age > CARD_MS) {
          this.retireCard(b);
          continue;
        }
        const enter = THREE.MathUtils.smoothstep(age, 0, 280);
        const leave = 1 - THREE.MathUtils.smoothstep(age, CARD_MS - 500, CARD_MS);
        b.card.style.opacity = Math.min(enter, leave).toFixed(2);
      }
    }
  }

  dispose(): void {
    this.reset();
    this.root.remove();
  }
}
