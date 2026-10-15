import * as THREE from 'three';
import { BlockType, type InspectorData, type WorldSnapshot } from '../../contracts';
import { entityMaterial, Kit, personGeometry } from '../entities/models';
import { columnTop } from '../terrain/mesher';
import { hash01, Y_SCALE } from '../units';

const MAX_SLOTS = 160;
const SHIRTS = [0x3f7cc8, 0xd9534f, 0xf0ad4e, 0x5cb85c, 0x8e6cc4, 0xe6e1d3, 0x2fa4a9, 0xc76b98];
const STAFF = { doctor: 0xf4f6f8, nurse: 0x6cc4b0 } as const;

type Mode = 'camp' | 'hospital';

const cotGeometry = (): THREE.BufferGeometry => {
  const k = new Kit();
  k.box(0, 0.035, 0, 0.12, 0.018, 0.24, 0x4f7896);
  k.box(0, 0.047, -0.085, 0.1, 0.012, 0.05, 0xe9e4d8);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * 0.05, 0.013, sz * 0.105, 0.012, 0.026, 0.012, 0x3a3f45);
  return k.build();
};

const bedGeometry = (): THREE.BufferGeometry => {
  const k = new Kit();
  k.box(0, 0.06, 0, 0.16, 0.04, 0.3, 0xf2f4f5);
  k.box(0, 0.083, 0.035, 0.162, 0.012, 0.2, 0x7fb8a4);
  k.box(0, 0.088, -0.11, 0.11, 0.02, 0.06, 0xffffff);
  k.box(0, 0.1, -0.148, 0.16, 0.1, 0.012, 0x9aa7ad);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * 0.07, 0.02, sz * 0.13, 0.014, 0.04, 0.014, 0x6b7378);
  return k.build();
};

const num = (v: number | string | undefined): number => (typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) || 0 : 0);

/**
 * Glass cutaway of the selected relief camp or hospital. The building's own
 * walls and roof are discarded by the lens shader (see `LensLayer.setXray`),
 * and this draws a glass shell, a floor and one figure per occupant slot so
 * the head count reads at a glance.
 */
export class InteriorView {
  readonly group = new THREE.Group();
  readonly chip: HTMLDivElement;
  private glass: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  private edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  private floor: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  private people: THREE.InstancedMesh;
  private cots: THREE.InstancedMesh;
  private beds: THREE.InstancedMesh;
  private nightUniforms: ReturnType<typeof entityMaterial>['uniforms'][];
  private dummy = new THREE.Object3D();
  private colour = new THREE.Color();
  private anchor = new THREE.Vector3();
  private v = new THREE.Vector3();
  private key = '';
  /** The cut box handed to the lens shader, or null when nothing is open. */
  box: THREE.Box3 | null = null;

  constructor() {
    this.group.name = 'interior-view';
    this.group.visible = false;
    this.glass = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.glass.renderOrder = 7;
    this.edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xe6f6ff, transparent: true, opacity: 0.75 }),
    );
    this.floor = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xd8ccb2 }));
    this.floor.receiveShadow = true;
    const person = entityMaterial();
    const cot = entityMaterial();
    const bed = entityMaterial();
    this.nightUniforms = [person.uniforms, cot.uniforms, bed.uniforms];
    this.people = new THREE.InstancedMesh(personGeometry(), person.material, MAX_SLOTS + 24);
    this.cots = new THREE.InstancedMesh(cotGeometry(), cot.material, MAX_SLOTS);
    this.beds = new THREE.InstancedMesh(bedGeometry(), bed.material, MAX_SLOTS);
    for (const m of [this.people, this.cots, this.beds]) {
      m.count = 0;
      m.frustumCulled = false;
    }
    this.group.add(this.floor, this.cots, this.beds, this.people, this.glass, this.edges);

    this.chip = document.createElement('div');
    this.chip.className = 'fs-interior';
    this.chip.style.display = 'none';
  }

  /** Opens the cutaway for a camp or hospital (from the inspector payload), or closes it. */
  set(world: WorldSnapshot | null, buildingId: number | null, data: InspectorData | null): void {
    const cells: number[] = [];
    if (world && buildingId !== null && data && data.kind === 'building' && data.id === buildingId) {
      for (let c = 0; c < world.buildingIndex.length; c++) if (world.buildingIndex[c] === buildingId + 1) cells.push(c);
    }
    const block = world && cells.length ? world.blocks[cells[0]] : -1;
    const mode: Mode | null = block === BlockType.Shelter ? 'camp' : block === BlockType.Hospital ? 'hospital' : null;
    if (!world || !data || !mode) {
      this.close();
      return;
    }
    const a = data.attributes;
    const capacity = Math.max(1, num(a.capacity));
    const inside = mode === 'camp' ? num(a.occupants) : num(a.patients);
    const key = `${buildingId}:${inside}:${capacity}`;
    const status = String(a.status ?? '');
    if (key === this.key) {
      this.renderChip(data.title, mode, inside, capacity, status);
      return;
    }
    this.key = key;

    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, g = -Infinity, top = 0;
    for (const c of cells) {
      const x = c % world.w;
      const z = (c - x) / world.w;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z + 1);
      g = Math.max(g, world.ground[c]);
      top = Math.max(top, columnTop(world, c));
    }
    const floorY = g * Y_SCALE + 0.04;
    const roofY = Math.max(top * Y_SCALE, floorY + 0.8);
    const sx = x1 - x0;
    const sz = z1 - z0;
    this.floor.scale.set(sx - 0.04, 0.04, sz - 0.04);
    this.floor.position.set(x0 + sx / 2, floorY - 0.02, z0 + sz / 2);
    this.floor.material.color.setHex(mode === 'camp' ? 0xd8ccb2 : 0xe6ecea);
    this.glass.scale.set(sx, roofY - floorY, sz);
    this.glass.position.set(x0 + sx / 2, (floorY + roofY) / 2, z0 + sz / 2);
    this.edges.scale.copy(this.glass.scale);
    this.edges.position.copy(this.glass.position);
    this.anchor.set(x0 + sx / 2, roofY + 0.3, z0 + sz / 2);
    // Window strips sit 0.015 proud of the walls, so the cut reaches a little past the footprint.
    const pad = 0.03;
    this.box = new THREE.Box3(new THREE.Vector3(x0 - pad, floorY + 0.005, z0 - pad), new THREE.Vector3(x1 + pad, 1e4, z1 + pad));

    // Slot grid: one cot or bed per slot, people standing beside or lying on them.
    const pitchX = mode === 'camp' ? 0.26 : 0.34;
    const pitchZ = mode === 'camp' ? 0.36 : 0.46;
    const cols = Math.max(1, Math.floor((sx - 0.2) / pitchX));
    const rows = Math.max(1, Math.floor((sz - 0.2) / pitchZ));
    const slots = Math.min(MAX_SLOTS, cols * rows, mode === 'hospital' ? capacity : MAX_SLOTS);
    const shownCapacity = Math.min(slots, capacity);
    const perFigure = Math.max(1, capacity / shownCapacity);
    const shownInside = Math.min(shownCapacity, Math.round(inside / perFigure) || (inside > 0 ? 1 : 0));
    const ox = x0 + (sx - (cols - 1) * pitchX) / 2;
    const oz = z0 + (sz - (rows - 1) * pitchZ) / 2;
    const d = this.dummy;
    let np = 0;
    const furniture = mode === 'camp' ? this.cots : this.beds;
    (mode === 'camp' ? this.beds : this.cots).count = 0;
    for (let i = 0; i < shownCapacity; i++) {
      const px = ox + (i % cols) * pitchX;
      const pz = oz + Math.floor(i / cols) * pitchZ;
      d.position.set(px, floorY, pz);
      d.rotation.set(0, 0, 0, 'XYZ');
      d.scale.setScalar(1);
      d.updateMatrix();
      furniture.setMatrixAt(i, d.matrix);
      if (i >= shownInside) continue;
      const r = hash01(i * 13 + (buildingId ?? 0));
      if (mode === 'hospital' || r < 0.35) {
        // On their back: head toward the pillow (-z), face up.
        d.position.set(px, floorY + (mode === 'hospital' ? 0.14 : 0.095), pz + (mode === 'hospital' ? 0.15 : 0.12));
        d.rotation.set(-Math.PI / 2, 0, Math.PI / 2, 'ZYX');
      } else {
        d.position.set(px + 0.09, floorY, pz + (r - 0.5) * 0.12);
        d.rotation.set(0, r * Math.PI * 2, 0, 'XYZ');
      }
      d.scale.setScalar(0.85);
      d.updateMatrix();
      this.people.setMatrixAt(np, d.matrix);
      this.people.setColorAt(np, this.colour.setHex(SHIRTS[Math.floor(r * 997) % SHIRTS.length]));
      np++;
    }
    furniture.count = shownCapacity;
    if (mode === 'hospital') {
      // Ward staff walking the aisles.
      const staff = Math.min(6, 2 + Math.ceil(inside / 4));
      for (let s = 0; s < staff; s++) {
        const r = hash01(s * 31 + 5);
        d.position.set(x0 + 0.2 + r * (sx - 0.4), floorY, z0 + 0.2 + hash01(s * 17 + 3) * (sz - 0.4));
        d.rotation.set(0, r * Math.PI * 2, 0, 'XYZ');
        d.scale.setScalar(0.85);
        d.updateMatrix();
        this.people.setMatrixAt(np, d.matrix);
        this.people.setColorAt(np, this.colour.setHex(s % 2 ? STAFF.doctor : STAFF.nurse));
        np++;
      }
    }
    this.people.count = np;
    for (const m of [this.people, this.cots, this.beds]) m.instanceMatrix.needsUpdate = true;
    if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true;
    this.group.visible = true;
    this.chip.dataset.scale = perFigure > 1.05 ? `each figure ≈ ${Math.round(perFigure)} people` : '';
    this.renderChip(data.title, mode, inside, capacity, status);
  }

  private renderChip(title: string, mode: Mode, inside: number, capacity: number, status: string): void {
    const pct = Math.min(100, Math.round((inside / capacity) * 100));
    const label = mode === 'camp' ? 'inside' : 'beds in use';
    const tone = pct >= 100 ? 'full' : pct >= 75 ? 'busy' : 'ok';
    this.chip.style.display = '';
    this.chip.dataset.tone = tone;
    this.chip.replaceChildren();
    const head = document.createElement('span');
    head.className = 'fs-interior-title';
    head.textContent = title;
    const count = document.createElement('b');
    count.textContent = `${inside} / ${capacity} ${label}`;
    const bar = document.createElement('span');
    bar.className = 'fs-interior-bar';
    const fill = document.createElement('i');
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    const foot = document.createElement('span');
    foot.className = 'fs-interior-foot';
    foot.textContent = [status, this.chip.dataset.scale].filter(Boolean).join(' · ');
    this.chip.append(head, count, bar, foot);
  }

  private close(): void {
    this.group.visible = false;
    this.chip.style.display = 'none';
    this.box = null;
    this.key = '';
  }

  update(camera: THREE.Camera, width: number, height: number, night: number): void {
    for (const u of this.nightUniforms) u.uNight.value = night;
    if (!this.group.visible) return;
    this.v.copy(this.anchor).project(camera);
    if (this.v.z > 1) {
      this.chip.style.opacity = '0';
      return;
    }
    const sx = (this.v.x * 0.5 + 0.5) * width;
    const sy = (-this.v.y * 0.5 + 0.5) * height;
    this.chip.style.opacity = '1';
    this.chip.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }

  dispose(): void {
    this.glass.geometry.dispose();
    this.glass.material.dispose();
    this.edges.geometry.dispose();
    this.edges.material.dispose();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    for (const m of [this.people, this.cots, this.beds]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.chip.remove();
  }
}
