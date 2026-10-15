import * as THREE from 'three';
import { PowerState, type RenderSnapshot, type WorldSnapshot } from '../../contracts';
import type { LandmarkCategory, MapLabel } from '../../bridge/sceneStore';
import { columnTop } from '../terrain/mesher';
import { Y_SCALE } from '../units';
import type { Footprint } from './LandmarkHalos';

const CATEGORY_NAME: Record<LandmarkCategory, string> = {
  medical: 'Hospital',
  shelter: 'Shelter',
  police: 'Police',
  command: 'Flood HQ',
  fire: 'Fire station',
  power: 'Power',
  boats: 'Boat depot',
  air: 'Helipad',
};

/** Higher draws first and wins overlaps. */
const PRIORITY: Record<LandmarkCategory, number> = {
  medical: 9,
  command: 8,
  shelter: 7,
  power: 6,
  fire: 5,
  police: 5,
  boats: 4,
  air: 3,
};

type Status = { text: string; tone: 'warn' | 'bad' } | null;

interface Item {
  label: MapLabel;
  el: HTMLElement;
  name: HTMLElement | null;
  status: HTMLElement | null;
  anchor: THREE.Vector3;
  footprint: Footprint | null;
  priority: number;
  width: number;
  statusText: string;
  visible: boolean;
}

/**
 * Map labels as DOM, projected from world anchors each frame: district names
 * when zoomed out, civic pins with live status when zoomed in. Overlapping
 * labels give way to higher-priority ones.
 */
export class LabelLayer {
  readonly root: HTMLDivElement;
  private items: Item[] = [];
  private v = new THREE.Vector3();
  private enabled = true;

  constructor(private onPick: (building: number) => void) {
    this.root = document.createElement('div');
    this.root.className = 'fs-labels';
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.root.style.display = on ? '' : 'none';
  }

  setLabels(labels: MapLabel[], world: WorldSnapshot, landmarks: Footprint[]): void {
    this.root.replaceChildren();
    this.items = [];
    const byId = new Map(landmarks.map((f) => [f.id, f]));
    for (const label of labels) {
      const footprint = label.building !== undefined ? (byId.get(label.building) ?? null) : null;
      if (label.kind === 'landmark' && !footprint) continue;
      const el = document.createElement(label.kind === 'landmark' ? 'button' : 'div');
      let name: HTMLElement | null = null;
      let status: HTMLElement | null = null;
      if (label.kind === 'district') {
        el.className = 'fs-district';
        el.textContent = label.text;
      } else {
        el.className = 'fs-pin';
        el.dataset.cat = label.category ?? 'medical';
        el.setAttribute('aria-label', `${label.text}, ${CATEGORY_NAME[label.category ?? 'medical']}`);
        const dot = document.createElement('span');
        dot.className = 'fs-pin-dot';
        name = document.createElement('span');
        name.className = 'fs-pin-name';
        name.textContent = label.text;
        status = document.createElement('span');
        status.className = 'fs-pin-status';
        el.append(dot, name, status);
        const id = label.building;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (id !== undefined) this.onPick(id);
        });
      }
      this.root.appendChild(el);
      const anchor = new THREE.Vector3(label.x, 0, label.z);
      if (footprint) {
        let top = 0;
        for (const c of footprint.cells) top = Math.max(top, columnTop(world, c));
        anchor.set((footprint.minX + footprint.maxX + 1) / 2, top * Y_SCALE + 0.9, (footprint.minZ + footprint.maxZ + 1) / 2);
      } else {
        const c = Math.floor(label.z) * world.w + Math.floor(label.x);
        anchor.y = (world.ground[c] ?? 0) * Y_SCALE + 3;
      }
      this.items.push({
        label,
        el,
        name,
        status,
        anchor,
        footprint,
        priority: label.kind === 'district' ? 1 : PRIORITY[label.category ?? 'air'],
        width: 0,
        statusText: '',
        visible: false,
      });
    }
    this.items.sort((a, b) => b.priority - a.priority);
  }

  /** Live status from power and water around each landmark. */
  setSnapshot(s: RenderSnapshot, world: WorldSnapshot): void {
    for (const it of this.items) {
      const f = it.footprint;
      if (!f || !it.status) continue;
      let gen = false;
      let off = false;
      let depth = 0;
      for (const c of f.cells) {
        const p = s.powered[c] as PowerState;
        if (p === PowerState.Generator) gen = true;
        if (p === PowerState.Off) off = true;
      }
      for (let z = f.minZ - 1; z <= f.maxZ + 1; z++) {
        for (let x = f.minX - 1; x <= f.maxX + 1; x++) {
          if (x < 0 || z < 0 || x >= world.w || z >= world.h) continue;
          depth = Math.max(depth, s.water[z * world.w + x] ?? 0);
        }
      }
      let st: Status = null;
      if (depth >= 0.3) st = { text: `Flooded ${depth.toFixed(1)} m`, tone: 'bad' };
      else if (off) st = { text: 'No power', tone: 'bad' };
      else if (gen) st = { text: 'On generator', tone: 'warn' };
      else if (depth >= 0.1) st = { text: 'Water at the door', tone: 'warn' };
      const text = st ? st.text : '';
      if (text !== it.statusText) {
        it.statusText = text;
        it.status.textContent = text;
        it.el.dataset.tone = st ? st.tone : '';
        it.width = 0;
      }
    }
  }

  /** Projects and lays out labels; `distance` is the camera's orbit distance. */
  update(camera: THREE.Camera, width: number, height: number, distance: number): void {
    if (!this.enabled) return;
    // District names sit underneath pins, so they only compete with each other.
    const pins: [number, number, number, number][] = [];
    const districts: [number, number, number, number][] = [];
    const overlaps = (placed: [number, number, number, number][], r: [number, number, number, number]) =>
      placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]);
    const districtAlpha = THREE.MathUtils.smoothstep(distance, 38, 70);
    const showNames = distance < 120;
    for (const it of this.items) {
      this.v.copy(it.anchor).project(camera);
      const onScreen = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      const sx = (this.v.x * 0.5 + 0.5) * width;
      const sy = (-this.v.y * 0.5 + 0.5) * height;
      let show = onScreen;
      if (show && it.label.kind === 'district') show = districtAlpha > 0.02;
      const compact = it.label.kind === 'landmark' && !showNames && !it.statusText;
      if (show) {
        if (!it.width || it.el.dataset.compact !== String(compact)) {
          it.el.dataset.compact = String(compact);
          it.width = it.el.offsetWidth || 80;
        }
        const w = it.width;
        const h = it.label.kind === 'district' ? 20 : 26;
        const rect: [number, number, number, number] = [sx - w / 2, sy - h, sx + w / 2, sy];
        const placed = it.label.kind === 'district' ? districts : pins;
        if (overlaps(placed, rect)) show = false;
        else placed.push(rect);
      }
      if (show) {
        it.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
        if (it.label.kind === 'district') it.el.style.opacity = districtAlpha.toFixed(2);
      }
      if (show !== it.visible) {
        it.visible = show;
        it.el.style.visibility = show ? 'visible' : 'hidden';
      }
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
