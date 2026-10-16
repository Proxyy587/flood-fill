import * as THREE from 'three';
import { UI_COLORS } from '../palette';

const unitBox = () => new THREE.BoxGeometry(1, 1, 1);

/** Places a unit-box object over `box`, grown by `pad` on every side. */
const fit = (o: THREE.Object3D, box: THREE.Box3, pad: number, size: THREE.Vector3): void => {
  box.getSize(size);
  box.getCenter(o.position);
  o.scale.set(size.x + pad * 2, size.y + pad * 2, size.z + pad * 2);
};

/**
 * Hover and selection marks. Both wrap the whole thing under the pointer:
 * a building's full footprint and height, or a single ground cell column.
 */
export class Markers {
  readonly group = new THREE.Group();
  private hover: THREE.LineSegments;
  private hoverFill: THREE.Mesh;
  private selection: THREE.Mesh;
  private selectionBox: THREE.LineSegments;
  private selectionFill: THREE.Mesh;
  private highlights: THREE.InstancedMesh;
  private creates: THREE.InstancedMesh;
  private alters: THREE.InstancedMesh;
  private highlightGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private highlightMat = new THREE.MeshBasicMaterial({
    color: UI_COLORS.highlight,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    depthTest: false,
  });
  private createMat = new THREE.MeshBasicMaterial({
    color: UI_COLORS.create,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthTest: false,
  });
  private alterMat = new THREE.MeshBasicMaterial({
    color: UI_COLORS.alter,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthTest: false,
  });
  private ringMat = new THREE.MeshBasicMaterial({ color: UI_COLORS.selection, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
  private hoverFillMat = new THREE.MeshBasicMaterial({ color: UI_COLORS.hover, transparent: true, opacity: 0.1, depthWrite: false, fog: false });
  private selectionFillMat = new THREE.MeshBasicMaterial({ color: UI_COLORS.selection, transparent: true, opacity: 0.16, depthWrite: false, fog: false });
  private dummy = new THREE.Object3D();
  private size = new THREE.Vector3();
  private hovering = false;

  constructor() {
    this.group.name = 'markers';
    this.hover = new THREE.LineSegments(
      new THREE.EdgesGeometry(unitBox()),
      new THREE.LineBasicMaterial({ color: UI_COLORS.hover, transparent: true, opacity: 0.85 }),
    );
    this.hover.visible = false;
    this.hoverFill = new THREE.Mesh(unitBox(), this.hoverFillMat);
    this.hoverFill.visible = false;
    this.hoverFill.renderOrder = 6;
    this.selection = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 32).rotateX(-Math.PI / 2), this.ringMat);
    this.selection.visible = false;
    this.selection.renderOrder = 7;
    this.selectionBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(unitBox()),
      new THREE.LineBasicMaterial({ color: UI_COLORS.selection, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.selectionBox.renderOrder = 9;
    this.selectionBox.visible = false;
    this.selectionFill = new THREE.Mesh(unitBox(), this.selectionFillMat);
    this.selectionFill.renderOrder = 6;
    this.selectionFill.visible = false;
    this.highlights = this.makeHighlightMesh(this.highlightMat);
    this.creates = this.makeHighlightMesh(this.createMat);
    this.alters = this.makeHighlightMesh(this.alterMat);
    this.group.add(this.hover, this.hoverFill, this.selection, this.selectionFill, this.selectionBox, this.highlights, this.creates, this.alters);
  }

  private makeHighlightMesh(mat: THREE.MeshBasicMaterial): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.highlightGeo, mat, 1024);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    return mesh;
  }

  /** Outline and soft fill over whatever the pointer is on (a whole building, or one cell). */
  setHover(box: THREE.Box3 | null): void {
    this.hovering = this.hover.visible = this.hoverFill.visible = !!box;
    if (!box) return;
    fit(this.hover, box, 0.02, this.size);
    fit(this.hoverFill, box, 0.025, this.size);
  }

  /** Ring that tracks a moving entity. */
  setSelectionPoint(p: THREE.Vector3 | null, now: number): void {
    this.selection.visible = !!p;
    if (!p) return;
    this.selection.position.set(p.x, p.y - 0.25, p.z);
    const s = 1 + Math.sin(now / 200) * 0.12;
    this.selection.scale.set(s, 1, s);
  }

  /** Box around a building footprint or a cell column. */
  setSelectionBox(box: THREE.Box3 | null): void {
    this.selectionBox.visible = this.selectionFill.visible = !!box;
    if (box) {
      fit(this.selectionBox, box, 0.03, this.size);
      fit(this.selectionFill, box, 0.035, this.size);
    }
    // The hover marks would double up on the selected thing.
    const same = !!box && this.hover.position.distanceToSquared(this.selectionBox.position) < 1e-4;
    this.hover.visible = this.hoverFill.visible = this.hovering && !same;
  }

  setHighlights(cells: number[], w: number, heightAt: (c: number) => number): void {
    this.placeInstances(this.highlights, cells, w, heightAt);
  }

  /** Green create ghosts and red alter ghosts for AI proposal preview. */
  setProposalGhosts(create: number[], alter: number[], w: number, heightAt: (c: number) => number): void {
    this.placeInstances(this.creates, create, w, heightAt);
    this.placeInstances(this.alters, alter, w, heightAt);
  }

  private placeInstances(mesh: THREE.InstancedMesh, cells: number[], w: number, heightAt: (c: number) => number): void {
    const n = Math.min(cells.length, 1024);
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      this.dummy.position.set((c % w) + 0.5, heightAt(c) + 0.06, Math.floor(c / w) + 0.5);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(now: number): void {
    const pulse = 0.35 + Math.sin(now / 220) * 0.15;
    this.highlightMat.opacity = pulse;
    this.createMat.opacity = 0.4 + Math.sin(now / 240) * 0.18;
    this.alterMat.opacity = 0.4 + Math.sin(now / 200) * 0.18;
    this.selectionFillMat.opacity = 0.13 + Math.sin(now / 320) * 0.05;
  }

  dispose(): void {
    for (const m of [this.hover, this.hoverFill, this.selectionBox, this.selectionFill]) m.geometry.dispose();
    (this.hover.material as THREE.Material).dispose();
    (this.selectionBox.material as THREE.Material).dispose();
    this.hoverFillMat.dispose();
    this.selectionFillMat.dispose();
    this.selection.geometry.dispose();
    this.ringMat.dispose();
    this.highlights.dispose();
    this.creates.dispose();
    this.alters.dispose();
    this.highlightGeo.dispose();
    this.highlightMat.dispose();
    this.createMat.dispose();
    this.alterMat.dispose();
  }
}
