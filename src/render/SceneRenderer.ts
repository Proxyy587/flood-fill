import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { PowerState, sameEntity, type EntityRef, type RenderSnapshot, type WorldSnapshot } from '../contracts';
import type { SimBridge } from '../bridge/SimBridge';
import { useSceneStore, type SceneState } from '../bridge/sceneStore';
import { CameraRig } from './camera/CameraRig';
import { Rain } from './effects/Rain';
import { daylightAt } from './effects/daylight';
import { lightningFlash } from './effects/lightning';
import { StreetLights } from './effects/StreetLights';
import { PoliceStations } from './props/PoliceStations';
import { EntityLayer } from './entities/EntityLayer';
import { Markers } from './overlays/Markers';
import { ReportRings } from './overlays/ReportRings';
import { RouteOverlay } from './overlays/RouteOverlay';
import { SignalLayer } from './overlays/SignalLayer';
import { Skyscape, type SkyLight } from './effects/Skyscape';
import { DAYLIGHT, SKY, ZENITH } from './palette';
import { columnTop, rampAt, rampHeight, type Ramp } from './terrain/mesher';
import { SkyIsland } from './terrain/SkyIsland';
import { TerrainLayer } from './terrain/TerrainLayer';
import { cellAt, Y_SCALE } from './units';
import { WaterLayer } from './water/WaterLayer';
import { EditPreview } from './overlays/EditPreview';
import { LabelLayer } from './overlays/LabelLayer';
import { findLandmarks, LandmarkHalos, type Footprint } from './overlays/LandmarkHalos';
import { LensLayer } from './overlays/LensLayer';
import { EventBeacons } from './overlays/EventBeacons';
import { InteriorView } from './overlays/InteriorView';
import { RoadStatus } from './overlays/RoadStatus';
import { useSimFeedStore } from '../bridge/simFeedStore';
import { useEditorStore } from '../ui/store/editorStore';
import { commitGesture, previewGesture } from '../editor/gestures';
import { BLOCK_VISUALS } from './palette';

const CLICK_SLOP_PX = 5;

/**
 * Owns the three.js scene. Reads `WorldSnapshot`/`RenderSnapshot` from the
 * bridge and UI state from `useSceneStore`; writes only hover/selection back.
 */
export class SceneRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private rig: CameraRig;
  private sun = new THREE.DirectionalLight(0xffe8d0, 0.95);
  private hemi = new THREE.HemisphereLight(0xe4eef8, 0x8a7a68, 1.05);
  private moon = new THREE.DirectionalLight(DAYLIGHT.moon, 0);
  private fill = new THREE.AmbientLight(0xc8d4e0, 0.18);
  private police = new PoliceStations();
  private streetLights = new StreetLights();
  private centre = new THREE.Vector3();
  private sunRadius = 60;
  private snapshotAt = 0;
  private c1 = new THREE.Color();
  private c2 = new THREE.Color();
  private terrain = new TerrainLayer();
  private water = new WaterLayer();
  private entities = new EntityLayer();
  private signals = new SignalLayer();
  private rings = new ReportRings();
  private route = new RouteOverlay();
  private markers = new Markers();
  private rain = new Rain();
  private editPreview = new EditPreview();
  private lens = new LensLayer();
  private halos = new LandmarkHalos();
  private labels: LabelLayer;
  private beacons: EventBeacons;
  private roads = new RoadStatus();
  private interior = new InteriorView();
  private island = new SkyIsland();
  private skyscape = new Skyscape();
  private skyLight: SkyLight = {
    day: 1,
    storm: 0,
    horizon: new THREE.Color(),
    zenith: new THREE.Color(),
    sun: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(0xffe0b8),
  };
  /** Share of building cells with power, for the city's glow on the clouds at night. */
  private litShare = 1;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private fxaa: FXAAPass;
  private hoverKey = '';
  private night = 0;
  private ramps = new Map<number, Ramp>();
  private landmarks: Footprint[] = [];
  private published = { heading: 0, tilt: 0 };
  private editPath: number[] = [];
  private raycaster = new THREE.Raycaster();
  private world: WorldSnapshot | null = null;
  private snapshot: RenderSnapshot | null = null;
  private store = useSceneStore;
  private offs: (() => void)[] = [];
  private frame = 0;
  private last = performance.now();
  private fpsFrames = 0;
  private fpsSince = performance.now();
  private pointer: { x: number; y: number; dirty: boolean; inside: boolean } = { x: 0, y: 0, dirty: false, inside: false };
  private down: { x: number; y: number } | null = null;
  private selectionBox: THREE.Box3 | null = null;
  private sky = new THREE.Color(SKY.clear);
  private stormSky = new THREE.Color(SKY.storm);
  private v = new THREE.Vector3();
  private resizeObserver: ResizeObserver;

  constructor(
    private container: HTMLElement,
    private bridge: SimBridge,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.rig = new CameraRig(this.renderer.domElement, (x, z) => this.groundY(x, z), (x, z) => this.obstacleY(x, z));
    this.labels = new LabelLayer((id) => this.store.getState().focus({ kind: 'building', id }));
    container.appendChild(this.labels.root);
    this.beacons = new EventBeacons((cell) => this.store.getState().focus({ kind: 'cell', id: cell }));
    container.appendChild(this.beacons.root);
    this.beacons.root.appendChild(this.interior.chip);
    for (const m of this.terrain.materials) this.lens.patch(m, 1, true);
    this.lens.patch(this.water.material, 0.55);
    // Solid sky colour + dome gradient; both track day/night so the void is never a flat grey.
    this.scene.background = this.sky;
    this.scene.fog = new THREE.Fog(SKY.clear, 120, 320);
    // Multisampled targets come back empty on some WebGL stacks, so anti-aliasing is FXAA on low-DPI screens instead.
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.55, 1.6);
    this.fxaa = new FXAAPass();
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.fxaa);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3.5;
    this.scene.add(
      this.hemi,
      this.fill,
      this.sun,
      this.sun.target,
      this.moon,
      this.police.group,
      this.streetLights.group,
      this.terrain.group,
      this.water.mesh,
      this.entities.group,
      this.signals.group,
      this.halos.mesh,
      this.rings.mesh,
      this.route.mesh,
      this.markers.group,
      this.rain.lines,
      this.editPreview.group,
      this.roads.group,
      this.beacons.group,
      this.interior.group,
      this.skyscape.group,
      this.island.group,
    );

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.bindInput();
    this.bindData();
    this.frame = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.offs.forEach((off) => off());
    this.resizeObserver.disconnect();
    this.rig.dispose();
    this.terrain.dispose();
    this.water.dispose();
    this.entities.dispose();
    this.signals.dispose();
    this.rings.dispose();
    this.route.dispose();
    this.markers.dispose();
    this.rain.dispose();
    this.editPreview.dispose();
    this.lens.dispose();
    this.halos.dispose();
    this.police.dispose();
    this.streetLights.dispose();
    this.labels.dispose();
    this.beacons.dispose();
    this.roads.dispose();
    this.interior.dispose();
    this.island.dispose();
    this.skyscape.dispose();
    this.bloom.dispose();
    this.fxaa.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- data ----------

  private bindData(): void {
    const b = this.bridge;
    this.offs.push(
      b.on('world', (w) => this.setWorld(w)),
      b.on('snapshot', (s) => this.setSnapshot(s)),
    );
    if (b.world) this.setWorld({ ...b.world, dirtyChunks: [] });
    if (b.snapshot) this.setSnapshot(b.snapshot);

    this.offs.push(
      this.store.subscribe((s, prev) => {
        if (s.camera.nonce !== prev.camera.nonce) this.applyCamera(s);
        if (s.cameraCmd && s.cameraCmd !== prev.cameraCmd) this.rig.command(s.cameraCmd.cmd);
        if (s.lens !== prev.lens) this.lens.setLens(s.lens);
        if (s.labels !== prev.labels) this.applyLabels(s);
        if (s.view !== prev.view && this.snapshot) this.applyWater(this.snapshot);
        if (s.inspector !== prev.inspector || s.overlays.routes !== prev.overlays.routes || !sameEntity(s.selected, prev.selected)) this.applyRoute(s);
        if (!sameEntity(s.selected, prev.selected)) this.selectionBox = this.boxFor(s.selected);
        if (s.inspector !== prev.inspector || !sameEntity(s.selected, prev.selected)) this.applyInterior(s);
        if (s.highlightCells !== prev.highlightCells) this.applyHighlights(s.highlightCells);
        if (s.overlays !== prev.overlays) this.applyOverlays(s);
      }),
    );
    this.applyOverlays(this.store.getState());
    this.lens.setLens(this.store.getState().lens);
    const applyEditor = () => {
      const s=useEditorStore.getState();
      this.rig.leftDragPans=!(s.mode==='edit'&&s.tool!=='select');
      const height=s.tool==='building'?BLOCK_VISUALS[s.block].height*Y_SCALE:0;
      this.editPreview.set(s.mode==='edit'?s.preview:[],s.previewValid,this.world,height);
    };
    this.offs.push(useEditorStore.subscribe(applyEditor));applyEditor();
    this.offs.push(
      useSimFeedStore.subscribe((s, prev) => {
        if (s.events.length < prev.events.length) this.beacons.reset();
        else if (s.events.length > prev.events.length) this.beacons.add(s.events.slice(prev.events.length), this.snapshot?.tick ?? 0, performance.now());
      }),
    );
  }

  private setWorld(w: WorldSnapshot): void {
    const first = !this.world || this.world.w !== w.w || this.world.h !== w.h;
    if (!first && w.dirtyChunks.length === 0) this.entities.reset();
    this.world = w;
    this.terrain.setWorld(w);
    this.police.setWorld(w);
    this.streetLights.setWorld(w, this.terrain.deckHeights);
    this.roads.setWorld(w, this.terrain.deckHeights);
    this.beacons.setWorld(w);
    this.island.setWorld(w);
    this.skyscape.setIsland(w.w / 2, w.h / 2, this.island.radius);
    this.hoverKey = '';
    this.ramps.clear();
    for (let c = 0; c < w.w * w.h; c++) {
      const r = rampAt(w, this.terrain.deckHeights, c);
      if (r) this.ramps.set(c, r);
    }
    this.water.setWorld(w);
    this.signals.setWorld(w);
    this.lens.setWorld(w);
    this.landmarks = findLandmarks(w);
    this.halos.setLandmarks(this.landmarks);
    this.applyLabels(this.store.getState());
    if (this.snapshot) {
      this.terrain.setPower(this.snapshot.powered);
      this.signals.setPower(this.snapshot.powered);
      this.streetLights.setPower(this.snapshot.powered);
      this.applyWater(this.snapshot);
    }
    if (first) {
      this.fitShadows(w);
      this.rig.overview(w.w, w.h, true);
    }
    this.selectionBox = this.boxFor(this.store.getState().selected);
    this.applyHighlights(this.store.getState().highlightCells);
  }

  private setSnapshot(s: RenderSnapshot): void {
    if (this.snapshot && (s.tick < this.snapshot.tick || s.tick === 0)) {
      this.entities.reset();
      this.beacons.reset();
    }
    this.snapshot = s;
    this.snapshotAt = performance.now();
    if (!this.world) return;
    this.entities.setSnapshot(s, performance.now());
    this.terrain.setPower(s.powered);
    this.signals.setPower(s.powered);
    this.streetLights.setPower(s.powered);
    this.rings.setReports(s.reports);
    this.litShare = this.poweredShare(s.powered);
    this.applyWater(s);
    this.roads.setSnapshot(s, (c) => this.water.surfaceAt(c));
    this.lens.setSnapshot(s);
    this.labels.setSnapshot(s, this.world);
  }

  private poweredShare(powered: Uint8Array): number {
    const w = this.world;
    if (!w || powered.length !== w.buildingIndex.length) return 1;
    let all = 0;
    let lit = 0;
    for (let c = 0; c < powered.length; c++) {
      if (!w.buildingIndex[c]) continue;
      all++;
      if (powered[c] !== PowerState.Off) lit++;
    }
    return all ? lit / all : 1;
  }

  /** Glass cutaway for a selected relief camp or hospital. */
  private applyInterior(s: SceneState): void {
    const sel = s.selected;
    this.interior.set(this.world, sel?.kind === 'building' ? sel.id : null, s.inspector);
    this.lens.setXray(this.interior.box);  }

  private applyLabels(s: SceneState): void {
    if (this.world) this.labels.setLabels(s.labels, this.world, this.landmarks);
  }

  private applyWater(s: RenderSnapshot): void {
    const belief = this.store.getState().view === 'belief' && !!s.hqBelief;
    this.water.setWater(belief && s.hqBelief ? s.hqBelief.water : s.water, belief);
    this.island.setWater((c) => this.water.surfaceAt(c));
  }

  private applyOverlays(s: SceneState): void {
    this.rings.mesh.visible = s.overlays.reports;
    this.signals.group.visible = s.overlays.signals;
    this.labels.setEnabled(s.overlays.labels);
    this.applyRoute(s);
  }

  private applyRoute(s: SceneState): void {
    const sel = s.selected;
    const showable = s.overlays.routes && sel && (sel.kind === 'npc' || sel.kind === 'vehicle');
    this.route.setRoute(showable && s.inspector?.route ? s.inspector.route.cells : null, this.world?.w ?? 1);
  }

  private applyHighlights(cells: number[]): void {
    if (!this.world) return;
    const w = this.world;
    this.markers.setHighlights(cells, w.w, (c) => Math.max(columnTop(w, c) * Y_SCALE, this.water.surfaceAt(c)));
  }

  private applyCamera(s: SceneState): void {
    if (!this.world) return;
    const { mode, target } = s.camera;
    if (mode === 'free') {
      this.rig.stopFollowing();
      return;
    }
    if (mode === 'overview' || !target) {
      this.rig.overview(this.world.w, this.world.h);
      return;
    }
    if (mode === 'follow' && (target.kind === 'npc' || target.kind === 'vehicle')) {
      const out = new THREE.Vector3();
      this.rig.followEntity(() => this.entities.positionOf(target, out));
      return;
    }
    const p = this.pointOf(target);
    if (p) this.rig.focusAt(p);
  }

  private pointOf(ref: EntityRef): THREE.Vector3 | null {
    if (ref.kind === 'npc' || ref.kind === 'vehicle') {
      const p = this.entities.positionOf(ref, new THREE.Vector3());
      return p ? p.clone() : null;
    }
    const box = this.boxFor(ref);
    return box ? box.getCenter(new THREE.Vector3()) : null;
  }

  /** Bounding box of a building footprint or a single cell column. */
  private boxFor(ref: EntityRef | null): THREE.Box3 | null {
    const w = this.world;
    if (!w || !ref || (ref.kind !== 'building' && ref.kind !== 'cell')) return null;
    const cells: number[] = [];
    if (ref.kind === 'cell') {
      if (ref.id >= 0 && ref.id < w.w * w.h) cells.push(ref.id);
    } else {
      for (let c = 0; c < w.buildingIndex.length; c++) if (w.buildingIndex[c] === ref.id + 1) cells.push(c);
    }
    if (!cells.length) return null;
    const box = new THREE.Box3();
    for (const c of cells) {
      const x = c % w.w;
      const z = Math.floor(c / w.w);
      box.expandByPoint(this.v.set(x, w.ground[c] * Y_SCALE, z));
      box.expandByPoint(this.v.set(x + 1, columnTop(w, c) * Y_SCALE + 0.02, z + 1));
    }
    return box;
  }

  private fitShadows(w: WorldSnapshot): void {
    const cx = w.w / 2;
    const cz = w.h / 2;
    const r = Math.hypot(w.w, w.h) / 2 + 4;
    this.centre.set(cx, 8, cz);
    this.sunRadius = r;
    this.sun.target.position.set(cx, 0, cz);
    this.rain.setCity(w.w, w.h);
    this.moon.target.position.set(cx, 0, cz);
    this.moon.position.set(cx + r * 0.4, r * 1.6, cz - r * 0.5);
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = r * 4;
    cam.updateProjectionMatrix();
    // Soft atmospheric haze — lifts the void into the sky without washing the city.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = r * 1.8;
    fog.far = r * 5.2;
  }

  /** Sun, sky, moon and night lighting from the simulated clock (render-only). */
  /** Sim time for this frame: the last snapshot's tick advanced by wall time at the run speed. */
  private simTickAt(st: SceneState, now: number): number {
    const running = st.playing && this.snapshot ? Math.min(1, (now - this.snapshotAt) / 1000) * st.speed : 0;
    return (this.snapshot?.tick ?? st.tick) + running;
  }

  private applyDaylight(st: SceneState, now: number, storm: number): void {
    const light = daylightAt(st.startSeconds + this.simTickAt(st, now));
    const day = light.day;
    const night = 1 - day;
    this.night = Math.max(night, storm * 0.55);
    const r = this.sunRadius;
    // Morning: crisp cool key. Afternoon: warmer and a little softer. Night: blue moonlight.
    this.sun.position.set(this.centre.x + light.sun.x * r * 1.6, Math.max(0.2, light.sun.y) * r * 1.6, this.centre.z + light.sun.z * r * 1.6);
    this.sun.color.setHex(DAYLIGHT.sun).lerp(this.c1.setHex(DAYLIGHT.sunLow), Math.max(light.golden, light.afternoon * 0.45));
    this.sun.intensity = Math.max(0, (1.42 + 0.12 * light.morning - 0.38 * light.afternoon - storm * 0.55) * day);
    this.sun.castShadow = st.overlays.shadows && day > 0.12;
    this.moon.color.setHex(DAYLIGHT.moon);
    this.moon.intensity = (0.55 + 0.2 * light.midnight) * night * (1 - storm * 0.35);
    this.hemi.color.setHex(DAYLIGHT.hemiSkyNight).lerp(this.c1.setHex(DAYLIGHT.hemiSkyDay), day);
    this.hemi.groundColor.setHex(DAYLIGHT.hemiGroundNight).lerp(this.c1.setHex(DAYLIGHT.hemiGroundDay), day);
    this.hemi.intensity = 0.62 + 0.38 * day - storm * 0.12 * day;
    this.fill.color.setHex(0xd4e8f8).lerp(this.c1.setHex(0x6a88c8), night);
    this.fill.intensity = 0.1 * day + 0.22 * night;
    // Clear morning blue → warm afternoon haze → golden → deep navy night.
    this.c1.setHex(SKY.morning).lerp(this.c2.setHex(SKY.afternoon), light.afternoon).lerp(this.sky.setHex(SKY.golden), light.golden * 0.75).lerp(this.stormSky, storm * 0.8);
    this.c2.setHex(SKY.night).lerp(this.sky.setHex(SKY.midnight), light.midnight * 0.55).lerp(this.sky.setHex(SKY.nightStorm), storm);
    this.sky.copy(this.c2).lerp(this.c1, day);
    (this.scene.background as THREE.Color).copy(this.sky);
    (this.scene.fog as THREE.Fog).color.copy(this.sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = r * (1.7 + light.morning * 0.7);
    fog.far = r * (4.4 + light.morning * 1.6 - light.afternoon * 0.4);
    const sl = this.skyLight;
    sl.day = day;
    sl.storm = storm;
    sl.horizon.copy(this.sky);
    sl.zenith
      .setHex(ZENITH.morning)
      .lerp(this.c1.setHex(ZENITH.afternoon), light.afternoon)
      .lerp(this.c1.setHex(ZENITH.golden), light.golden * 0.75)
      .lerp(this.c2.setHex(ZENITH.storm), storm * 0.8);
    sl.zenith.lerp(this.c1.setHex(ZENITH.night), night);
    sl.zenith.lerp(this.c1.setHex(ZENITH.midnight), light.midnight * night * 0.65);
    sl.sun.set(light.sun.x, light.sun.y, light.sun.z).normalize();
    sl.sunColor!.copy(this.sun.color);
    this.renderer.toneMappingExposure = 0.88 + 0.2 * day + 0.06 * light.morning - 0.1 * light.afternoon;
    this.bloom.threshold = 0.72 + 1.15 * day;
    this.bloom.strength = 0.05 + 0.42 * this.night;
    this.bloom.radius = 0.42;
    this.terrain.setNight(night, this.c1.setHex(DAYLIGHT.windowsNight));
    this.streetLights.update(night);
    this.entities.setNight(Math.max(night, storm * 0.55));
    this.police.setLighting(night, this.snapshot?.powered ?? null);
  }

  private applyLightning(flash: number): void {
    if (flash <= 0) return;
    this.hemi.intensity += flash * 2.2;
    this.hemi.color.lerp(this.c1.setHex(0xe8eeff), flash);
    this.sky.lerp(this.c1.setHex(0xd6defa), flash * 0.75);
    (this.scene.background as THREE.Color).copy(this.sky);
    (this.scene.fog as THREE.Fog).color.copy(this.sky);
    this.renderer.toneMappingExposure += flash * 0.35;
  }

  // ---------- heights ----------

  private groundY = (x: number, z: number): number => {
    const w = this.world;
    if (!w) return 0;
    const c = cellAt(w.w, w.h, x, z);
    if (c < 0) return 0;
    const deck = this.terrain.deckHeights[c];
    if (deck >= 0) return deck * Y_SCALE;
    const ramp = this.ramps.get(c);
    if (ramp) return rampHeight(ramp, x - Math.floor(x), z - Math.floor(z));
    return w.ground[c] * Y_SCALE;
  };

  private waterY = (x: number, z: number): number => {
    const w = this.world;
    if (!w) return -Infinity;
    const c = cellAt(w.w, w.h, x, z);
    return c < 0 ? -Infinity : this.water.surfaceAt(c);
  };

  private surfaceY = (x: number, z: number): number => Math.max(this.groundY(x, z), this.waterY(x, z));

  /** Highest solid thing in a cell (roof, deck or water), for keeping the camera out of buildings. */
  private obstacleY = (x: number, z: number): number => {
    const w = this.world;
    if (!w) return 0;
    const c = cellAt(w.w, w.h, x, z);
    if (c < 0) return 0;
    return Math.max(columnTop(w, c) * Y_SCALE, this.groundY(x, z), this.waterY(x, z));
  };

  // ---------- input ----------

  private bindInput(): void {
    const el = this.renderer.domElement;
    const local = (e: PointerEvent | MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      this.pointer = { x: p.x, y: p.y, dirty: true, inside: true };
      const state=useEditorStore.getState();
      if(state.mode==='edit'&&state.tool!=='select') {
        const hit=this.pickAt(p.x,p.y);
        if(hit.cell>=0){
          if(this.editPath.length&&this.editPath.at(-1)!==hit.cell)this.editPath.push(hit.cell);
          const preview=previewGesture(this.editPath[0]??hit.cell,hit.cell,this.editPath.length?this.editPath:[hit.cell]);
          useEditorStore.setState({preview:preview.cells,previewValid:preview.errors.length===0});
        }
      }
    };
    const onLeave = () => {
      this.pointer.inside = false;
      this.store.getState().setHover(null, null);
      this.store.setState({ hoverInfo: null });
      this.markers.setHover(null);
      this.hoverKey = '';
      if(!this.editPath.length)useEditorStore.setState({preview:[]});
    };
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) {
        this.down = local(e);
        const s=useEditorStore.getState();
        if(s.mode==='edit'&&s.tool!=='select'){
          const hit=this.pickAt(this.down.x,this.down.y);
          this.editPath=hit.cell>=0?[hit.cell]:[];
          el.setPointerCapture(e.pointerId);
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !this.down) return;
      const p = local(e);
      const state=useEditorStore.getState();
      if(state.mode==='edit'&&state.tool!=='select') {
        const hit=this.pickAt(p.x,p.y);
        if(this.editPath.length&&hit.cell>=0)commitGesture(this.editPath[0],hit.cell,[...this.editPath,hit.cell]);
        this.editPath=[];this.down=null;
        if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);
        useEditorStore.setState({preview:[]});return;
      }
      const moved = Math.hypot(p.x - this.down.x, p.y - this.down.y) > CLICK_SLOP_PX;
      this.down = null;
      if (moved) return;
      const hit = this.pickAt(p.x, p.y);
      this.store.getState().select(hit.entity ?? (hit.cell >= 0 ? { kind: 'cell', id: hit.cell } : null));
    };
    const onDouble = (e: MouseEvent) => {
      if(useEditorStore.getState().mode==='edit'&&useEditorStore.getState().tool!=='select')return;
      const p = local(e);
      const hit = this.pickAt(p.x, p.y);
      const ref = hit.entity ?? (hit.cell >= 0 ? { kind: 'cell' as const, id: hit.cell } : null);
      if (!ref) return;
      if (ref.kind === 'npc' || ref.kind === 'vehicle') this.store.getState().follow(ref);
      else this.store.getState().focus(ref);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const st = this.store.getState();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'h' || e.key === 'H') st.overview();
      if ((e.key === 'f' || e.key === 'F') && st.selected) {
        if (st.selected.kind === 'npc' || st.selected.kind === 'vehicle') st.follow(st.selected);
        else st.focus(st.selected);
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('dblclick', onDouble);
    const onCancel=()=>{this.editPath=[];this.down=null;useEditorStore.setState({preview:[]});};
    el.addEventListener('pointercancel',onCancel);
    window.addEventListener('keydown', onKey);
    this.offs.push(() => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('dblclick', onDouble);
      el.removeEventListener('pointercancel',onCancel);
      window.removeEventListener('keydown', onKey);
    });
  }

  private pickAt(px: number, py: number): { entity: EntityRef | null; cell: number } {
    const w = this.world;
    const el = this.renderer.domElement;
    const width = el.clientWidth;
    const height = el.clientHeight;
    const entity = this.entities.pick(this.rig.camera, px, py, width, height);
    let cell = -1;
    if (w) {
      this.raycaster.setFromCamera(new THREE.Vector2((px / width) * 2 - 1, -(py / height) * 2 + 1), this.rig.camera);
      const hit = this.raycaster.intersectObjects(this.terrain.meshes, false)[0];
      if (hit) {
        const n = hit.face?.normal ?? new THREE.Vector3(0, 1, 0);
        cell = cellAt(w.w, w.h, hit.point.x - n.x * 0.01, hit.point.z - n.z * 0.01);
      }
    }
    if (entity) return { entity, cell };
    if (w && cell >= 0 && w.buildingIndex[cell] > 0) return { entity: { kind: 'building', id: w.buildingIndex[cell] - 1 }, cell };
    return { entity: null, cell };
  }

  private updateHover(): void {
    const w = this.world;
    if (!this.pointer.dirty || !this.pointer.inside || !w) return;
    this.pointer.dirty = false;
    const hit = this.pickAt(this.pointer.x, this.pointer.y);
    this.store.getState().setHover(hit.cell >= 0 ? hit.cell : null, hit.entity);
    const r = this.renderer.domElement.getBoundingClientRect();
    this.store.setState({
      hoverInfo:
        hit.cell >= 0
          ? {
              cell: hit.cell,
              elevation: w.ground[hit.cell],
              depth: this.snapshot ? (this.snapshot.water[hit.cell] ?? 0) : 0,
              screen: { x: r.left + this.pointer.x, y: r.top + this.pointer.y },
            }
          : null,
    });
    // Buildings highlight as a whole; open ground highlights the one cell column.
    const ref: EntityRef | null = hit.entity?.kind === 'building' ? hit.entity : hit.cell >= 0 && !hit.entity ? { kind: 'cell', id: hit.cell } : null;
    const key = ref ? `${ref.kind}:${ref.id}` : '';
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      this.markers.setHover(this.boxFor(ref));
    }
    this.renderer.domElement.style.cursor = hit.entity ? 'pointer' : 'default';
  }

  // ---------- frame ----------

  /** Heading and tilt for the compass, published only when they change visibly. */
  private publishCamera(): void {
    const heading = this.rig.heading;
    const tilt = this.rig.tilt;
    if (Math.abs(heading - this.published.heading) < 0.004 && Math.abs(tilt - this.published.tilt) < 0.004) return;
    this.published = { heading, tilt };
    this.store.setState({ heading, tilt });
  }

  private resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    this.fxaa.enabled = this.renderer.getPixelRatio() < 1.5;
    this.rig.resize(width, height);
  }

  private tick = (): void => {
    this.frame = requestAnimationFrame(this.tick);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const st = this.store.getState();

    this.entities.update(now, dt, this.groundY, this.waterY);
    this.signals.update(this.simTickAt(st, now));
    this.rings.update(now, this.surfaceY);
    this.markers.update(now);
    this.rig.update(dt);
    this.lens.update(dt);
    this.halos.update(now, st.lens === 'none' ? 1 : 0.55);
    this.updateHover();
    this.publishCamera();

    const sel = st.selected;
    const selPoint = sel && (sel.kind === 'npc' || sel.kind === 'vehicle') ? this.entities.positionOf(sel, this.v) : null;
    this.markers.setSelectionPoint(selPoint, now);
    this.markers.setSelectionBox(this.selectionBox);
    this.route.update(selPoint, this.surfaceY, now);

    const weather = this.snapshot?.weather ?? { rain: 0, wind: 0 };
    // Anchor rain on the city, not the orbit target — otherwise it sticks to the screen centre.
    this.rain.update(dt, this.centre, weather.rain, weather.wind, st.overlays.rain);
    this.applyDaylight(st, now, Math.min(1, weather.rain * 0.9));
    this.applyLightning(st.playing ? lightningFlash(now, weather.rain) : 0);

    this.roads.update(now, this.night);
    this.skyLight.horizon.copy(this.sky);
    this.skyscape.update(now, this.skyLight, this.night * this.litShare * 0.22, 0);
    this.island.update(now, this.skyLight.day, this.night);

    this.composer.render(dt);
    const el = this.renderer.domElement;
    this.beacons.update(now, this.rig.camera, el.clientWidth, el.clientHeight, this.surfaceY);
    this.interior.update(this.rig.camera, el.clientWidth, el.clientHeight, this.night);
    this.labels.update(this.rig.camera, el.clientWidth, el.clientHeight, this.rig.camera.position.distanceTo(this.rig.target));

    this.fpsFrames++;
    if (now - this.fpsSince > 1000) {
      this.store.setState({ fps: Math.round((this.fpsFrames * 1000) / (now - this.fpsSince)) });
      this.fpsFrames = 0;
      this.fpsSince = now;
    }
  };
}
