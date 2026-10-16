import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BlockType, type Scenario } from '../../contracts';
import { insideForest, mapNoise, SIX_MILE_BOUNDARY, type DistrictPlace } from '../../editor/geography/sixMile';

export interface MapAnchor { id: string; text: string; x: number; z: number; kind: 'place' | 'water' | 'area' }
export interface ScreenAnchor extends MapAnchor { left: number; top: number; visible: boolean }
/** Synthetic Guwahati atlas anchors — north = low Z (Brahmaputra), south = high Z (NH27). */
export const CITY_ANCHORS: MapAnchor[] = [
  { id: 'six-mile', text: 'Six Mile', x: 168, z: 96, kind: 'place' },
  { id: 'paltan', text: 'Paltan Bazaar', x: 118, z: 48, kind: 'place' },
  { id: 'biswanath', text: 'Biswanath Town', x: 238, z: 22, kind: 'place' },
  { id: 'river', text: 'BRAHMAPUTRA', x: 110, z: 22, kind: 'water' },
  { id: 'wetland', text: 'Deepor Bil', x: 48, z: 92, kind: 'water' },
  { id: 'north', text: 'NORTH GUWAHATI', x: 96, z: 8, kind: 'area' },
  { id: 'nilachal', text: 'NILACHAL', x: 72, z: 58, kind: 'area' },
  { id: 'jalukbari', text: 'JALUKBARI', x: 58, z: 68, kind: 'area' },
  { id: 'dispur', text: 'DISPUR', x: 142, z: 78, kind: 'area' },
  { id: 'airport', text: 'AIRPORT', x: 28, z: 102, kind: 'area' },
];

type Box = { x: number; y: number; z: number; w: number; h: number; d: number; id?: number; angle?: number };

/** Static, read-only geography scene. It never owns simulation state. */
export class GeographyRenderer {
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.OrthographicCamera();
  private controls: OrbitControls;
  private root = new THREE.Group();
  private batches = new Map<string, Box[]>();
  private observer: ResizeObserver;
  private frame = 0;
  private dirty = true;
  private width = 1;
  private height = 1;
  private span: number;
  private origin: THREE.Vector3;
  private anchors: MapAnchor[];
  private highlight = new THREE.Group();
  private down = { x: 0, y: 0 };
  private interactive: THREE.InstancedMesh[] = [];
  private places: DistrictPlace[];

  constructor(private element: HTMLElement, scenario: Scenario | null, places: DistrictPlace[],
    private onAnchors: (anchors: ScreenAnchor[]) => void, private onSelect: (id: number) => void) {
    this.places = places;
    // Atlas: fill the frame with Guwahati (river→NH27). District keeps a wider local view.
    this.span = scenario ? 150 : 178;
    this.origin = new THREE.Vector3(scenario ? 64 : 118, 0, scenario ? 64 : 64);
    this.anchors = scenario ? places.slice(0, 10).filter(p => [1, 2, 5, 8].includes(p.id)).map(p => ({ id: String(p.id), text: p.name, x: p.x, z: p.z, kind: 'place' })) : CITY_ANCHORS;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setClearColor(0xe6ece7, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = .95;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    element.appendChild(this.renderer.domElement);
    this.camera.position.set(0, 160, 127);
    this.camera.near = .1;
    this.camera.far = 800;
    this.camera.lookAt(0, 0, 12);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 12);
    this.controls.enableDamping = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controls.dampingFactor = .12;
    // Ortho: higher zoom = closer. Atlas cannot pull back past city overview.
    this.controls.minZoom = scenario ? 0.75 : 1.05;
    this.controls.maxZoom = scenario ? 4 : 2.8;
    this.controls.minPolarAngle = .2;
    this.controls.maxPolarAngle = 1.1;
    this.controls.minAzimuthAngle = -.55;
    this.controls.maxAzimuthAngle = .55;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.controls.addEventListener('change', this.changed);
    this.root.position.copy(this.origin).multiplyScalar(-1);
    this.scene.add(this.root);
    this.root.add(this.highlight);
    const ambient = new THREE.HemisphereLight(0xf5f8f0, 0x7f9188, 1.8);
    const sun = new THREE.DirectionalLight(0xfff2d9, 2.2);
    sun.position.set(-70, 140, 70);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 400 });
    sun.shadow.bias = -.001;
    sun.shadow.normalBias = .06;
    this.scene.add(ambient, sun);
    if (scenario) this.district(scenario); else this.city();
    this.flush();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0xe2e9e2, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.4;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(element);
    this.resize();
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.animate();
  }

  private changed = () => { this.dirty = true; };
  private resize = () => {
    this.width = this.element.clientWidth;
    this.height = this.element.clientHeight;
    if (!this.width || !this.height) return;
    const aspect = this.width / this.height;
    const horizontal = this.span / Math.min(1, aspect);
    this.camera.left = -horizontal * aspect / 2;
    this.camera.right = horizontal * aspect / 2;
    this.camera.top = horizontal / 2;
    this.camera.bottom = -horizontal / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
    this.dirty = true;
  };
  private animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    this.controls.update();
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    this.onAnchors(this.anchors.map(a => {
      const point = new THREE.Vector3(a.x, 5, a.z).sub(this.origin).project(this.camera);
      return { ...a, left: (point.x + 1) * this.width / 2, top: (1 - point.y) * this.height / 2, visible: Math.abs(point.x) < .97 && Math.abs(point.y) < .96 };
    }));
  };
  private box(color: string, box: Box) {
    const batch = this.batches.get(color) ?? [];
    batch.push(box);
    this.batches.set(color, batch);
  }
  private flush() {
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const [color, boxes] of this.batches) {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color, roughness: .88 }), boxes.length);
      boxes.forEach((b, i) => {
        quaternion.setFromAxisAngle(up, b.angle ?? 0);
        matrix.compose(new THREE.Vector3(b.x, b.y, b.z), quaternion, new THREE.Vector3(b.w, b.h, b.d));
        mesh.setMatrixAt(i, matrix);
      });
      mesh.castShadow = boxes.some(b => b.h > .7);
      mesh.receiveShadow = true;
      mesh.userData.ids = boxes.map(b => b.id);
      if (boxes.some(b => b.id !== undefined)) this.interactive.push(mesh);
      this.root.add(mesh);
    }
    this.batches.clear();
  }
  private shape(points: readonly (readonly [number, number])[], color: number, y: number, depth = 0) {
    const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geometry = depth ? new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .92, side: THREE.DoubleSide }));
    mesh.position.y = y;
    mesh.receiveShadow = true;
    mesh.castShadow = depth > 0;
    this.root.add(mesh);
  }
  private ribbon(points: readonly (readonly [number, number])[], width: number, color: number, y: number, smooth = true) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, y, z)));
    const samples = smooth ? curve.getPoints(180) : points.flatMap(([x, z], i) => {
      if (i === points.length - 1) return [new THREE.Vector3(x, y, z)];
      const [nx, nz] = points[i + 1];
      return Array.from({ length: 24 }, (_, step) => new THREE.Vector3(x + (nx - x) * step / 24, y, z + (nz - z) * step / 24));
    });
    const vertices: number[] = [], indices: number[] = [];
    samples.forEach((p, i) => {
      const next = samples[Math.min(i + 1, samples.length - 1)], prev = samples[Math.max(0, i - 1)];
      const tangent = next.clone().sub(prev).normalize();
      const dx = -tangent.z * width / 2, dz = tangent.x * width / 2;
      vertices.push(p.x + dx, p.y, p.z + dz, p.x - dx, p.y, p.z - dz);
      if (i) { const a = i * 2; indices.push(a - 2, a - 1, a, a, a - 1, a + 1); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    this.root.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: .9 })));
  }
  private tree(x: number, z: number, y: number, size = 1) {
    this.box('#7c8170', { x, z, y: y + size * .7, w: .25 * size, d: .25 * size, h: size * 1.4 });
    this.box('#7d9a7b', { x, z, y: y + size * 1.9, w: 1.5 * size, d: 1.5 * size, h: 1.7 * size });
    this.box('#93aa86', { x: x - size * .15, z, y: y + size * 2.8, w: size, d: size, h: size * .65 });
  }
  /** Layered ridge mound — forested highs like Nilachal / Kahilipara / zoo ridge. */
  private hill(x: number, z: number, rx: number, rz: number, height: number, stretch = 1) {
    for (let level = 0; level < height; level += 1.25) {
      const t = level / (height + 2);
      const points: [number, number][] = Array.from({ length: 20 }, (_, i) => {
        const angle = i * Math.PI * 2 / 20;
        const wobble = 1 + Math.sin(i * 2.4 + x * 0.1) * 0.1;
        return [
          x + Math.cos(angle) * rx * (1 - t * 0.72) * wobble,
          z + Math.sin(angle) * rz * (1 - t * 0.72) * stretch * wobble,
        ];
      });
      const green = level > height * 0.55 ? 0x6f8a62 : level > height * 0.25 ? 0x7d966c : 0x8fa186;
      this.shape(points, green, 0.2 + level, 1.2);
    }
  }

  /** Shallow floodable basin tint between ridges. */
  private basin(x: number, z: number, rx: number, rz: number) {
    const points: [number, number][] = Array.from({ length: 18 }, (_, i) => {
      const angle = i * Math.PI * 2 / 18;
      return [x + Math.cos(angle) * rx * (1 + Math.sin(i * 2) * 0.1), z + Math.sin(angle) * rz];
    });
    this.shape(points, 0x7fa4a0, 0.22, 0.4);
    this.shape(points.map(([px, pz]) => [px * 0.78 + x * 0.22, pz * 0.78 + z * 0.22] as [number, number]), 0x6a949c, 0.28, 0.2);
  }

  private city() {
    // Guwahati-like composition from the overview map: river north, Deepor SW,
    // Nilachal + southern ridges, dense basins, Six Mile SE, NH27 south edge.
    this.shape([[-10, 125], [40, -8], [230, -18], [250, 70], [210, 130], [40, 140]], 0xb4c0ab, -3.0, 1.3);

    // Urban platform (south bank) — not a perfect oval; river-cut northern edge.
    const cityPoly: [number, number][] = [
      [14, 108], [22, 78], [38, 52], [58, 34], [82, 22], [112, 18], [148, 20],
      [178, 28], [196, 48], [202, 78], [192, 104], [168, 118], [132, 124],
      [96, 122], [62, 120], [34, 116],
    ];
    this.shape(cityPoly, 0x9aaa8e, -1.8, 2.0);

    // —— Highs: Nilachal (W), south-central hills, eastern / zoo ridge ——
    this.hill(70, 56, 18, 14, 12, 0.85);   // Nilachal / Kamakhya mass
    this.hill(88, 78, 12, 10, 8, 0.9);    // mid shoulder
    this.hill(108, 98, 20, 14, 10, 0.75); // Kahilipara / Jyotikuchi band
    this.hill(128, 92, 14, 11, 8, 0.8);
    this.hill(152, 70, 16, 12, 11, 0.7);  // eastern ridge toward Six Mile
    this.hill(168, 78, 11, 9, 7, 0.85);
    this.hill(48, 88, 10, 8, 5, 1);       // Jalukbari rise
    this.hill(178, 52, 9, 7, 5, 1);       // NE shelf

    // —— Lows: river fringe, GS Road / Six Mile hollows, central dips ——
    this.basin(118, 58, 11, 7);   // Paltan / Ulubari low
    this.basin(138, 72, 10, 7);   // Dispur fringe
    this.basin(158, 92, 14, 10);  // Six Mile / Beltola hollow
    this.basin(148, 100, 9, 6);
    this.basin(98, 68, 8, 5);     // between Nilachal and south hills
    this.basin(72, 74, 7, 5);

    // Brahmaputra — wide northern ribbon + sand chars
    const river: [number, number][] = [
      [8, 42], [36, 30], [62, 22], [90, 18], [120, 16], [150, 18], [178, 22], [205, 26], [230, 20],
    ];
    this.ribbon(river, 22, 0xc5c8ad, 0.2);
    this.ribbon(river, 17, 0x7eacb4, 0.28);
    this.ribbon(river, 12.5, 0x6b9eab, 0.34);
    this.ribbon([[20, 38], [55, 26], [95, 18], [140, 17], [185, 22]], 0.2, 0xb8d4d6, 0.38);
    // Sandbars / chars
    this.shape([[58, 24], [72, 20], [86, 22], [78, 28], [64, 28]], 0xd4ceb0, 0.42, 0.14);
    this.shape([[108, 14], [124, 12], [138, 15], [128, 19], [112, 18]], 0xd4ceb0, 0.42, 0.14);
    this.shape([[156, 18], [170, 16], [182, 20], [170, 24]], 0xd0c9a8, 0.42, 0.12);
    // Saraighat-ish crossing west
    this.ribbon([[48, 36], [52, 28], [56, 18], [58, 8]], 1.8, 0xe3dfd2, 1.1);

    // Deepor Bil — large SW wetland
    this.shape([[34, 82], [44, 76], [58, 78], [64, 88], [58, 98], [42, 100], [32, 92]], 0x6f9aa0, 0.3, 0.15);
    this.shape([[38, 84], [48, 80], [56, 84], [54, 92], [42, 94]], 0x5f8d96, 0.34, 0.1);

    // North Guwahati bank strip
    this.shape([[70, 2], [90, -2], [120, 0], [140, 4], [130, 10], [100, 8], [78, 8]], 0xa3b094, -0.4, 1.2);
    for (let i = 0; i < 14; i++) {
      const x = 82 + mapNoise(i, 1) * 48, z = 2 + mapNoise(i, 4) * 8;
      this.box('#c9c4b0', { x, z, y: 0.9, w: 1.4, d: 1.5, h: 0.8 + mapNoise(i, 6) * 1.6 });
    }

    // Arterials: Assam Trunk (river), GS Road SE, NH27 south, ring links
    const roads: [number, number][][] = [
      [[24, 70], [48, 52], [78, 40], [112, 36], [148, 40], [178, 46]], // river road
      [[112, 36], [118, 48], [124, 62], [142, 78], [158, 90], [172, 100]], // GS Road → Six Mile
      [[40, 112], [72, 114], [110, 116], [148, 114], [180, 108], [198, 96]], // NH27
      [[58, 68], [78, 72], [98, 78], [118, 82], [138, 86]], // mid belt
      [[88, 40], [98, 56], [108, 70], [120, 82]],
      [[148, 40], [156, 58], [164, 76], [170, 92]],
    ];
    roads.forEach((r) => {
      this.ribbon(r, 2.2, 0xb0b09e, 0.55);
      this.ribbon(r, 1.45, 0xe4dcc8, 0.6);
    });

    // Dense urban fabric in basins; sparse / none on ridges and wetland
    const onHill = (x: number, z: number) =>
      Math.hypot((x - 70) / 18, (z - 56) / 14) < 1
      || Math.hypot((x - 108) / 20, (z - 98) / 14) < 1
      || Math.hypot((x - 152) / 16, (z - 70) / 12) < 1
      || Math.hypot((x - 128) / 14, (z - 92) / 11) < 1
      || Math.hypot((x - 48) / 10, (z - 88) / 8) < 1;
    const inBasin = (x: number, z: number) =>
      Math.hypot((x - 158) / 14, (z - 92) / 10) < 1
      || Math.hypot((x - 118) / 11, (z - 58) / 7) < 1
      || Math.hypot((x - 138) / 10, (z - 72) / 7) < 1
      || Math.hypot((x - 98) / 8, (z - 68) / 5) < 1;
    const inDeepor = (x: number, z: number) => Math.hypot((x - 48) / 16, (z - 90) / 12) < 1;

    for (let z = 32; z < 118; z += 2.6) for (let x = 40; x < 198; x += 2.7) {
      if (z < 28 || onHill(x, z) || inDeepor(x, z)) continue;
      const value = mapNoise(Math.round(x), Math.round(z));
      const basin = inBasin(x, z);
      const core = (x > 95 && x < 155 && z > 40 && z < 90) || (x > 145 && z > 80);
      const density = basin ? 0.08 : core ? 0.14 : 0.28;
      if (value < density) continue;
      const base = basin ? 0.28 : 0.65;
      const height = (basin ? 0.6 : 0.9) + value * (basin ? 2.2 : core ? 4.8 : 3.2);
      const color = basin ? '#a4b4a4' : value > 0.78 ? '#bdb4a0' : value < 0.35 ? '#d5d1be' : '#b4beaf';
      this.box(color, { x, z, y: height / 2 + base, w: 1.7, d: 1.8, h: height });
      this.box('#cfd3c6', { x, z, y: height + base + 0.08, w: 1.85, d: 1.95, h: 0.16 });
    }

    // Forest canopy on ridges
    for (let i = 0; i < 420; i++) {
      const x = 40 + mapNoise(i, 5) * 150, z = 36 + mapNoise(i, 9) * 78;
      if (!onHill(x, z) && mapNoise(i, 12) > 0.35) continue;
      if (inDeepor(x, z)) continue;
      this.tree(x, z, onHill(x, z) ? 2.2 : 0.45, onHill(x, z) ? 0.95 : 0.65);
    }

    // Airport runway west of Deepor
    this.box('#e3e1d2', { x: 28, z: 102, y: 0.5, w: 2.4, d: 18, h: 0.28, angle: -0.55 });
    this.box('#d8d6c8', { x: 32, z: 100, y: 0.7, w: 4, d: 3, h: 0.5 });

    // Biswanath — small regional town NE on the Assam shelf
    for (let i = 0; i < 20; i++) {
      const x = 228 + mapNoise(i, 3) * 16, z = 14 + mapNoise(i, 7) * 14;
      this.box(mapNoise(i, 2) > 0.6 ? '#c4bba6' : '#d2cebb', { x, z, y: 1.0, w: 1.5, d: 1.6, h: 0.9 + mapNoise(i, 4) * 2 });
    }

    for (const a of CITY_ANCHORS.filter((a) => a.kind === 'place')) {
      const pad = a.id === 'biswanath' ? 3.2 : 5;
      this.box('#39777c', { x: a.x, z: a.z, y: 1.15, w: pad, d: pad, h: 1.5 });
      this.box('#e8efe6', { x: a.x, z: a.z, y: 2.1, w: pad * 0.8, d: pad * 0.8, h: 0.35 });
    }
  }
  private district(s: Scenario) {
    this.box('#899a83', { x: 64, z: 64, y: -1.1, w: 128, d: 128, h: 2 });
    for (let c = 0; c < s.blocks.length; c++) {
      const x = c % s.size.w + .5, z = Math.floor(c / s.size.w) + .5, block = s.blocks[c];
      const y = s.ground[c] * .35;
      const shade = mapNoise(Math.floor(x / 4), Math.floor(z / 4), 3);
      const grove = insideForest(Math.floor(x), Math.floor(z));
      const soil = block === BlockType.Sand ? '#c8c2a5' : grove ? (shade > .55 ? '#6f8f5e' : '#7a9866') : shade > .6 ? '#aab79a' : shade < .25 ? '#a2b092' : '#a6b497';
      this.box(soil, { x, z, y: y / 2, w: 1, d: 1, h: Math.max(.12, y) });
      if (block === BlockType.WaterSource) this.box('#548f9d', { x, z, y: .42, w: 1.01, d: 1.01, h: .3 });
      if (block === BlockType.Road || block === BlockType.Bridge) {
        const top = block === BlockType.Bridge ? 1.2 : y + .08;
        this.box(block === BlockType.Bridge ? '#839b94' : '#8e9e96', { x, z, y: top, w: 1, d: 1, h: .12 });
        if (block === BlockType.Bridge && c % 3 === 0) this.box('#718a85', { x, z, y: .55, w: .25, d: .25, h: 1.1 });
      }
      if (block === BlockType.Tree) this.tree(x, z, y, (grove ? .85 : .55) + shade * .35);
      if (block === BlockType.Drainage) this.box('#627f78', { x, z, y: y + .08, w: .65, d: .65, h: .12 });
    }
    // The reference perimeter is a calm inlay rather than a flashing hazard overlay.
    this.ribbon([...SIX_MILE_BOUNDARY, SIX_MILE_BOUNDARY[0]], .23, 0xe1cc9b, 1.3, false);
    for (const b of s.buildings) {
      const xs = b.cells.map(c => c % s.size.w), zs = b.cells.map(c => Math.floor(c / s.size.w));
      const w = Math.max(...xs) - Math.min(...xs) + 1, d = Math.max(...zs) - Math.min(...zs) + 1;
      const x = Math.min(...xs) + w / 2, z = Math.min(...zs) + d / 2;
      const hospital = b.type === BlockType.Hospital;
      const height = hospital ? 7 : b.type === BlockType.Apartment ? 5 + mapNoise(b.id, 2) * 5 : b.type === BlockType.Office ? 5 : b.type === BlockType.Helipad ? .2 : 2 + mapNoise(b.id, 2) * 2;
      const color = hospital ? '#e4e6d9' : b.type === BlockType.Shelter ? '#c6cfb3' : b.type === BlockType.PoliceStation || b.type === BlockType.FloodHQ ? '#a9bec0' : b.type === BlockType.PowerPlant || b.type === BlockType.Substation ? '#b8b3a3' : b.type === BlockType.Shop ? '#cfb99d' : b.type === BlockType.Apartment ? '#c9cbb9' : '#ded5bf';
      this.box(color, { x, z, y: 1.05 + height / 2, w: w - .3, d: d - .3, h: height, id: b.id });
      this.box(b.type === BlockType.House ? '#9eaaa2' : '#e1dfd0', { x, z, y: 1.15 + height, w: w - .15, d: d - .15, h: .25, id: b.id });
      if (height > 2) for (let level = 2; level < height; level += 1.6) {
        this.box('#839b9a', { x, z: z + d / 2 - .12, y: 1.05 + level, w: w * .65, d: .09, h: .45, id: b.id });
        this.box('#8fa5a2', { x: x + w / 2 - .12, z, y: 1.05 + level, w: .09, d: d * .65, h: .45, id: b.id });
      }
      if (hospital) {
        this.box('#ba6d57', { x, z, y: height + 1.32, w: 2.6, d: .7, h: .12 });
        this.box('#ba6d57', { x, z, y: height + 1.32, w: .7, d: 2.6, h: .12 });
      } else if (b.type === BlockType.Helipad) {
        this.box('#547f7e', { x, z, y: 1.4, w: w - .4, d: d - .4, h: .1 });
        for (const dx of [-.7, .7]) this.box('#eee9d6', { x: x + dx, z, y: 1.48, w: .22, d: 2.2, h: .08 });
        this.box('#eee9d6', { x, z, y: 1.48, w: 1.5, d: .22, h: .08 });
      } else if (b.type === BlockType.PowerPlant || b.type === BlockType.Office) {
        this.box('#6e929a', { x, z, y: height + 1.36, w: w * .55, d: d * .5, h: .15 });
      } else if (b.type === BlockType.House) {
        this.box('#839b9a', { x: x + w / 4, z, y: height + 1.45, w: .5, d: .5, h: .45 });
      }
    }
  }
  private pointerDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY }; };
  private pointerUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5 || e.button !== 0) return;
    const rect = this.element.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.camera);
    const hit = ray.intersectObjects(this.interactive, false)[0];
    if (hit?.instanceId !== undefined) {
      const id: number | undefined = hit.object.userData.ids[hit.instanceId];
      if (id !== undefined) this.onSelect(id);
    }
  };
  select(id: number | null) {
    for (const child of [...this.highlight.children]) {
      if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); }
      this.highlight.remove(child);
    }
    const place = this.places.find(p => p.id === id);
    if (place) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(4.5, 4.8, 64), new THREE.MeshBasicMaterial({ color: 0x267a7b, side: THREE.DoubleSide, transparent: true, opacity: .8, depthTest: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(place.x, 1.4, place.z);
      ring.renderOrder = 4;
      this.highlight.add(ring);
    }
    this.dirty = true;
  }
  focus(x: number, z: number) {
    const target = new THREE.Vector3(x, 0, z).sub(this.origin);
    const delta = target.clone().sub(this.controls.target);
    this.camera.position.add(delta);
    this.controls.target.copy(target);
    this.camera.zoom = 1.8;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.dirty = true;
  }
  /** Smooth pan + zoom into a map point. Resolves when the flight finishes. */
  flyInto(x: number, z: number, zoomTo = 3.6): Promise<void> {
    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = new THREE.Vector3(x, 0, z).sub(this.origin);
    if (reduce) {
      const delta = target.clone().sub(this.controls.target);
      this.camera.position.add(delta);
      this.controls.target.copy(target);
      this.camera.zoom = zoomTo;
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this.dirty = true;
      return Promise.resolve();
    }
    const fromTarget = this.controls.target.clone();
    const fromPos = this.camera.position.clone();
    const fromZoom = this.camera.zoom;
    const toPos = fromPos.clone().add(target.clone().sub(fromTarget));
    // Slight dive: pull the camera a bit lower as we arrive so the district fills the frame.
    toPos.y = Math.max(40, fromPos.y * 0.55);
    const duration = 2200;
    const started = performance.now();
    this.controls.enabled = false;
    const ease = (t: number) => {
      // Smoothstep quintic — soft start and soft landing, no linear snag.
      const u = t * t * t * (t * (t * 6 - 15) + 10);
      return u;
    };
    return new Promise(resolve => {
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / duration);
        const e = ease(t);
        this.controls.target.lerpVectors(fromTarget, target, e);
        this.camera.position.lerpVectors(fromPos, toPos, e);
        this.camera.zoom = fromZoom + (zoomTo - fromZoom) * ease(t);
        this.camera.updateProjectionMatrix();
        this.controls.update();
        this.dirty = true;
        this.renderer.render(this.scene, this.camera);
        if (t < 1) requestAnimationFrame(step);
        else {
          this.controls.enabled = true;
          this.controls.update();
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }
  zoom(factor: number) {
    const min = this.controls.minZoom;
    const max = this.controls.maxZoom;
    this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, min, max);
    this.camera.updateProjectionMatrix(); this.dirty = true;
  }
  reset() {
    this.camera.position.set(0, 160, 127);
    this.controls.target.set(0, 0, 12);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix(); this.controls.update(); this.dirty = true;
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect(); this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
        if (object instanceof THREE.InstancedMesh) object.dispose();
      }
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    });
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
