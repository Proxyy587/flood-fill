import * as THREE from 'three';
import { UI_COLORS } from '../palette';

/** Hover cell outline, selection ring/box and evidence-cell highlights. */
export class Markers {
  readonly group = new THREE.Group();
  private hover: THREE.LineSegments;
  private selection: THREE.Mesh;
  private selectionBox: THREE.LineSegments;
  private highlights: THREE.InstancedMesh;
  private highlightGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private highlightMat = new THREE.MeshBasicMaterial({
    color: UI_COLORS.highlight,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    depthTest: false,
  });
  private ringMat = new THREE.MeshBasicMaterial({ color: UI_COLORS.selection, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
  private dummy = new THREE.Object3D();

  constructor() {
    this.group.name = 'markers';
    this.hover = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: UI_COLORS.hover, transparent: true, opacity: 0.8 }),
    );
    this.hover.visible = false;
    this.selection = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 32).rotateX(-Math.PI / 2), this.ringMat);
    this.selection.visible = false;
    this.selection.renderOrder = 7;
    this.selectionBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: UI_COLORS.selection, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.selectionBox.renderOrder = 9;
    this.selectionBox.visible = false;
    this.highlights = new THREE.InstancedMesh(this.highlightGeo, this.highlightMat, 1024);
    this.highlights.count = 0;
    this.highlights.frustumCulled = false;
    this.highlights.renderOrder = 8;
    this.group.add(this.hover, this.selection, this.selectionBox, this.highlights);
  }

  setHover(x: number, z: number, y0: number, y1: number, visible: boolean): void {
    this.hover.visible = visible;
    if (!visible) return;
    const hgt = Math.max(0.05, y1 - y0);
    this.hover.position.set(x + 0.5, y0 + hgt / 2, z + 0.5);
    this.hover.scale.set(1.02, hgt + 0.02, 1.02);
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
    this.selectionBox.visible = !!box;
    if (!box) return;
    const size = box.getSize(new THREE.Vector3());
    box.getCenter(this.selectionBox.position);
    this.selectionBox.scale.set(size.x + 0.06, size.y + 0.06, size.z + 0.06);
  }

  setHighlights(cells: number[], w: number, heightAt: (c: number) => number): void {
    const n = Math.min(cells.length, 1024);
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      this.dummy.position.set((c % w) + 0.5, heightAt(c) + 0.06, Math.floor(c / w) + 0.5);
      this.dummy.updateMatrix();
      this.highlights.setMatrixAt(i, this.dummy.matrix);
    }
    this.highlights.count = n;
    this.highlights.instanceMatrix.needsUpdate = true;
  }

  update(now: number): void {
    this.highlightMat.opacity = 0.35 + Math.sin(now / 220) * 0.15;
  }

  dispose(): void {
    this.hover.geometry.dispose();
    (this.hover.material as THREE.Material).dispose();
    this.selection.geometry.dispose();
    this.ringMat.dispose();
    this.selectionBox.geometry.dispose();
    (this.selectionBox.material as THREE.Material).dispose();
    this.highlights.dispose();
    this.highlightGeo.dispose();
    this.highlightMat.dispose();
  }
}
