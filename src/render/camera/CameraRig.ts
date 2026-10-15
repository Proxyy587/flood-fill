import * as THREE from 'three';
import type { CameraCommand, ViewPreset } from '../../bridge/sceneStore';

const PRESET_PITCH: Record<ViewPreset, number> = { top: 0.02, oblique: 0.86, side: 1.32 };
const MIN_PITCH = 0.02;
const MAX_PITCH = 1.42;
const MIN_DISTANCE = 4;
const FOCUS_DISTANCE = 22;
const FOLLOW_DISTANCE = 14;
const CLEARANCE = 1.6;
/** Response rates (1/s) for exponential smoothing; higher is snappier. */
const ORBIT_RATE = 14;
const ZOOM_RATE = 10;
const FOLLOW_RATE = 7;
const KEY_PAN_SPEED = 0.9;
const KEY_ROTATE_SPEED = 1.6;

interface Pose {
  target: THREE.Vector3;
  yaw: number;
  pitch: number;
  distance: number;
}

interface Flight {
  from: Pose;
  to: Pose;
  t: number;
  duration: number;
  arc: number;
}

type Drag = { mode: 'pan' | 'orbit'; id: number; x: number; y: number; grab: THREE.Vector3 | null; moved: boolean };

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/**
 * A map-style camera: grab-to-pan with momentum, right-drag orbit, zoom
 * toward the cursor, eased fly-to, smooth follow, and a terrain clamp.
 * It owns its own input so every motion goes through the same smoothing.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Ground point the camera orbits. Smoothed toward `goal.target`. */
  readonly target = new THREE.Vector3();
  /** When false, plain left-drag is left to the editor (paint tools). */
  leftDragPans = true;

  private yaw = -0.62;
  private pitch = PRESET_PITCH.oblique;
  private distance = 120;
  private goal: Pose = { target: new THREE.Vector3(), yaw: -0.62, pitch: PRESET_PITCH.oblique, distance: 120 };
  private flight: Flight | null = null;
  private follow: (() => THREE.Vector3 | null) | null = null;
  private velocity = new THREE.Vector2();
  private drag: Drag | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; angle: number; midY: number } | null = null;
  private keys = new Set<string>();
  private bounds = { w: 64, h: 64 };
  private maxDistance = 260;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2();
  private tmp = new THREE.Vector3();
  private offs: (() => void)[] = [];

  constructor(
    private dom: HTMLElement,
    private heightAt: (x: number, z: number) => number,
    private obstacleAt: (x: number, z: number) => number = heightAt,
  ) {
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
    this.bindInput();
  }

  // ---------- commands ----------

  get heading(): number {
    return this.yaw;
  }

  get tilt(): number {
    return this.pitch;
  }

  get following(): boolean {
    return this.follow !== null;
  }

  setBounds(w: number, h: number): void {
    this.bounds = { w, h };
  }

  /** Frames the whole grid. */
  overview(w: number, h: number, instant = false): void {
    this.follow = null;
    this.bounds = { w, h };
    const vfov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hfov = Math.atan(Math.tan(vfov) * this.camera.aspect);
    const distance = (Math.hypot(w, h) * 0.5) / Math.sin(Math.min(vfov, hfov));
    this.maxDistance = Math.max(160, distance * 1.6);
    const pose: Pose = {
      target: new THREE.Vector3(w / 2, this.heightAt(w / 2, h / 2), h / 2),
      yaw: -0.62,
      pitch: PRESET_PITCH.oblique,
      distance,
    };
    if (instant) {
      this.setPose(pose);
      this.copyPose(pose, this.goal);
      this.flight = null;
      this.apply();
      return;
    }
    this.flyTo(pose);
  }

  focusAt(point: THREE.Vector3, distance = FOCUS_DISTANCE): void {
    this.follow = null;
    this.flyTo({ ...this.currentPose(), target: point.clone(), distance: Math.min(distance, Math.max(this.distance, distance * 0.6)) });
  }

  followEntity(get: () => THREE.Vector3 | null): void {
    this.follow = get;
    const p = get();
    this.flyTo({ ...this.currentPose(), target: p ? p.clone() : this.target.clone(), distance: FOLLOW_DISTANCE, pitch: Math.min(this.pitch, 1.05) });
  }

  stopFollowing(): void {
    this.follow = null;
  }

  command(cmd: CameraCommand): void {
    this.flight = null;
    this.velocity.set(0, 0);
    if (cmd.kind === 'rotate') this.goal.yaw += cmd.by;
    if (cmd.kind === 'north') this.goal.yaw = this.yaw - wrapAngle(this.yaw);
    if (cmd.kind === 'tilt') this.goal.pitch = PRESET_PITCH[cmd.preset];
    if (cmd.kind === 'zoom') this.goal.distance = this.clampDistance(this.goal.distance * cmd.by);
  }

  // ---------- frame ----------

  update(dt: number): void {
    this.applyKeys(dt);
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.duration);
      const e = easeInOutCubic(f.t);
      this.target.lerpVectors(f.from.target, f.to.target, e);
      if (this.follow) {
        const p = this.follow();
        if (p) f.to.target.copy(p);
      }
      this.yaw = f.from.yaw + (f.to.yaw - f.from.yaw) * e;
      this.pitch = f.from.pitch + (f.to.pitch - f.from.pitch) * e;
      this.distance = (f.from.distance + (f.to.distance - f.from.distance) * e) * (1 + f.arc * Math.sin(Math.PI * e));
      if (f.t >= 1) {
        this.flight = null;
        this.copyPose(f.to, this.goal);
      }
    } else {
      if (this.follow) {
        const p = this.follow();
        if (p) this.goal.target.lerp(p, approach(FOLLOW_RATE, dt));
      } else if (!this.drag && this.velocity.lengthSq() > 1e-6) {
        this.goal.target.x += this.velocity.x * dt;
        this.goal.target.z += this.velocity.y * dt;
        this.velocity.multiplyScalar(Math.exp(-dt * 4.5));
      }
      this.clampTarget(this.goal.target);
      const ground = this.heightAt(this.goal.target.x, this.goal.target.z);
      if (!this.follow) this.goal.target.y += (ground - this.goal.target.y) * approach(3, dt);
      const k = this.drag?.mode === 'pan' ? 1 : approach(ZOOM_RATE, dt);
      this.target.lerp(this.goal.target, k);
      const ko = approach(ORBIT_RATE, dt);
      this.yaw += (this.goal.yaw - this.yaw) * ko;
      this.pitch += (this.goal.pitch - this.pitch) * ko;
      this.distance += (this.goal.distance - this.distance) * approach(ZOOM_RATE, dt);
    }
    this.apply();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.offs.forEach((off) => off());
  }

  // ---------- internals ----------

  private apply(): void {
    const sp = Math.sin(this.pitch);
    const cp = Math.cos(this.pitch);
    const pos = this.camera.position;
    pos.set(this.target.x + this.distance * sp * Math.sin(this.yaw), this.target.y + this.distance * cp, this.target.z + this.distance * sp * Math.cos(this.yaw));
    const floor = this.obstacleAt(pos.x, pos.z) + CLEARANCE;
    if (pos.y < floor) pos.y = floor;
    // At a straight-down view `lookAt` loses its roll reference; keep "up" on screen pointing along the heading.
    this.camera.up.set(-Math.sin(this.yaw) * (1 - sp), sp, -Math.cos(this.yaw) * (1 - sp)).normalize();
    this.camera.lookAt(this.target);
  }

  private flyTo(to: Pose): void {
    const from = this.currentPose();
    to.yaw = from.yaw + wrapAngle(to.yaw - from.yaw);
    to.distance = this.clampDistance(to.distance);
    to.pitch = THREE.MathUtils.clamp(to.pitch, MIN_PITCH, MAX_PITCH);
    const travel = from.target.distanceTo(to.target);
    const duration = THREE.MathUtils.clamp(0.55 + travel / 90 + Math.abs(Math.log(to.distance / from.distance)) * 0.25, 0.55, 1.6);
    const arc = THREE.MathUtils.clamp(travel / Math.max(from.distance, to.distance) - 0.4, 0, 0.6) * 0.5;
    this.velocity.set(0, 0);
    this.flight = { from, to, t: 0, duration, arc };
  }

  private currentPose(): Pose {
    return { target: this.target.clone(), yaw: this.yaw, pitch: this.pitch, distance: this.distance };
  }

  private setPose(p: Pose): void {
    this.target.copy(p.target);
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.distance = p.distance;
  }

  private copyPose(from: Pose, to: Pose): void {
    to.target.copy(from.target);
    to.yaw = from.yaw;
    to.pitch = from.pitch;
    to.distance = from.distance;
  }

  /** Drops any fly-to in progress and continues from where the camera is now. */
  private takeOver(): void {
    if (!this.flight) return;
    this.flight = null;
    this.copyPose(this.currentPose(), this.goal);
  }

  private clampDistance(d: number): number {
    return THREE.MathUtils.clamp(d, MIN_DISTANCE, this.maxDistance);
  }

  private clampTarget(t: THREE.Vector3): void {
    const m = 6;
    t.x = THREE.MathUtils.clamp(t.x, -m, this.bounds.w + m);
    t.z = THREE.MathUtils.clamp(t.z, -m, this.bounds.h + m);
  }

  /** Where a screen point meets the horizontal plane through the orbit target. */
  private groundPoint(px: number, py: number, out: THREE.Vector3): THREE.Vector3 | null {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.plane.constant = -this.target.y;
    return this.raycaster.ray.intersectPlane(this.plane, out);
  }

  private zoomAt(px: number, py: number, factor: number): void {
    this.takeOver();
    const next = this.clampDistance(this.goal.distance * factor);
    const f = next / this.goal.distance;
    if (f === 1) return;
    const p = this.groundPoint(px, py, this.tmp);
    if (p && !this.follow) {
      // Scale the target about the cursor's ground point so that point stays put.
      this.goal.target.x = p.x + (this.goal.target.x - p.x) * f;
      this.goal.target.z = p.z + (this.goal.target.z - p.z) * f;
    }
    this.goal.distance = next;
  }

  private orbitBy(dx: number, dy: number): void {
    this.takeOver();
    this.goal.yaw -= dx * 0.0065;
    this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch - dy * 0.005, MIN_PITCH, MAX_PITCH);
  }

  private applyKeys(dt: number): void {
    if (!this.keys.size) return;
    const k = this.keys;
    let fx = 0;
    let fz = 0;
    if (k.has('w') || k.has('arrowup')) fz -= 1;
    if (k.has('s') || k.has('arrowdown')) fz += 1;
    if (k.has('a') || k.has('arrowleft')) fx -= 1;
    if (k.has('d') || k.has('arrowright')) fx += 1;
    let spin = 0;
    if (k.has('q')) spin -= 1;
    if (k.has('e')) spin += 1;
    let zoom = 0;
    if (k.has('=') || k.has('+')) zoom -= 1;
    if (k.has('-') || k.has('_')) zoom += 1;
    if (!fx && !fz && !spin && !zoom) return;
    this.takeOver();
    if (fx || fz) {
      this.follow = null;
      const speed = this.distance * KEY_PAN_SPEED * dt;
      const s = Math.sin(this.yaw);
      const c = Math.cos(this.yaw);
      this.goal.target.x += (fx * c + fz * s) * speed;
      this.goal.target.z += (-fx * s + fz * c) * speed;
    }
    if (spin) this.goal.yaw += spin * KEY_ROTATE_SPEED * dt;
    if (zoom) this.goal.distance = this.clampDistance(this.goal.distance * Math.exp(zoom * 1.6 * dt));
  }

  private bindInput(): void {
    const el = this.dom;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        el.setPointerCapture(e.pointerId);
        this.takeOver();
        this.velocity.set(0, 0);
        if (this.touches.size === 1) this.startPan(e);
        else this.startPinch();
        return;
      }
      const orbit = e.button === 2 || (e.button === 0 && (e.shiftKey || e.altKey || e.ctrlKey));
      const pan = e.button === 1 || (e.button === 0 && this.leftDragPans && !orbit);
      if (!orbit && !pan) return;
      el.setPointerCapture(e.pointerId);
      this.takeOver();
      this.velocity.set(0, 0);
      if (orbit) this.drag = { mode: 'orbit', id: e.pointerId, x: e.clientX, y: e.clientY, grab: null, moved: false };
      else this.startPan(e);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.touches.size >= 2) {
          this.movePinch();
          return;
        }
      }
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      if (d.mode === 'orbit') {
        this.orbitBy(dx, dy);
      } else if (d.grab) {
        const p = this.groundPoint(e.clientX, e.clientY, this.tmp);
        if (p) {
          this.follow = null;
          const mx = d.grab.x - p.x;
          const mz = d.grab.z - p.z;
          this.goal.target.x += mx;
          this.goal.target.z += mz;
          this.target.x += mx;
          this.target.z += mz;
          const dt = Math.max(1, e.timeStamp - (this.lastMove || e.timeStamp)) / 1000;
          this.velocity.set(this.velocity.x * 0.5 + (mx / dt) * 0.5, this.velocity.y * 0.5 + (mz / dt) * 0.5);
          this.apply();
        }
      }
      this.lastMove = e.timeStamp;
      d.x = e.clientX;
      d.y = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        this.touches.delete(e.pointerId);
        this.pinch = null;
        if (this.touches.size === 1) {
          const [id, t] = [...this.touches.entries()][0];
          this.drag = { mode: 'pan', id, x: t.x, y: t.y, grab: this.groundPoint(t.x, t.y, new THREE.Vector3()), moved: true };
          return;
        }
      }
      if (this.drag?.id === e.pointerId) {
        const stale = e.timeStamp - this.lastMove > 80;
        if (this.drag.mode !== 'pan' || stale || !this.drag.moved) this.velocity.set(0, 0);
        else this.velocity.clampLength(0, this.distance * 3);
        this.drag = null;
      }
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dy = e.deltaY * unit;
      const dx = e.deltaX * unit;
      if (e.ctrlKey) {
        // Trackpad pinch arrives as ctrl+wheel with small deltas.
        this.zoomAt(e.clientX, e.clientY, Math.exp(dy * 0.012));
        return;
      }
      if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        this.orbitBy(dx * 0.6, 0);
        return;
      }
      if (e.shiftKey) {
        this.orbitBy(0, dy * 0.6);
        return;
      }
      this.zoomAt(e.clientX, e.clientY, Math.exp(THREE.MathUtils.clamp(dy, -120, 120) * 0.0022));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', '=', '+', '-', '_', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        if (key.startsWith('arrow')) e.preventDefault();
        this.keys.add(key);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    const onBlur = () => this.keys.clear();
    const onContext = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.offs.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });
  }

  private lastMove = 0;

  private startPan(e: PointerEvent): void {
    this.drag = { mode: 'pan', id: e.pointerId, x: e.clientX, y: e.clientY, grab: this.groundPoint(e.clientX, e.clientY, new THREE.Vector3()), moved: false };
    this.lastMove = e.timeStamp;
  }

  private startPinch(): void {
    this.drag = null;
    const [a, b] = [...this.touches.values()];
    this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x), midY: (a.y + b.y) / 2 };
  }

  private movePinch(): void {
    const [a, b] = [...this.touches.values()];
    if (!this.pinch) this.startPinch();
    const p = this.pinch;
    if (!p) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const midY = (a.y + b.y) / 2;
    if (dist > 0 && p.dist > 0) this.zoomAt((a.x + b.x) / 2, midY, p.dist / dist);
    this.goal.yaw += wrapAngle(angle - p.angle);
    this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch - (midY - p.midY) * 0.004, MIN_PITCH, MAX_PITCH);
    this.pinch = { dist, angle, midY };
  }
}
