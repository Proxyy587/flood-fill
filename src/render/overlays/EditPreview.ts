import * as THREE from 'three';
import type { WorldSnapshot } from '../../contracts';
import { Y_SCALE } from '../units';

/** Ghost cells are cosmetic; validity comes from the editor's document checks. */
export class EditPreview {
  readonly group=new THREE.Group();
  private geometry=new THREE.BoxGeometry(.96,.08,.96);
  private material=new THREE.MeshBasicMaterial({color:0x67dfc6,transparent:true,opacity:.48,depthWrite:false});
  private mesh=new THREE.InstancedMesh(this.geometry,this.material,1);
  private dummy=new THREE.Object3D();
  constructor(){this.group.add(this.mesh);this.mesh.frustumCulled=false;this.mesh.count=0;this.group.renderOrder=8;}
  set(cells:number[],valid:boolean,world:WorldSnapshot|null,height=0):void {
    if(!world){this.mesh.count=0;return;}
    if(this.mesh.instanceMatrix.count<cells.length){
      this.group.remove(this.mesh);this.mesh.dispose();
      this.mesh=new THREE.InstancedMesh(this.geometry,this.material,cells.length);this.mesh.frustumCulled=false;this.group.add(this.mesh);
    }
    this.material.color.setHex(valid?0x67dfc6:0xff6675);
    cells.forEach((c,i)=>{
      this.dummy.position.set(c%world.w+.5,world.ground[c]*Y_SCALE+.07+height/2,Math.floor(c/world.w)+.5);
      this.dummy.scale.set(1,Math.max(.08,height)/.08,1);this.dummy.updateMatrix();this.mesh.setMatrixAt(i,this.dummy.matrix);
    });
    this.mesh.count=cells.length;this.mesh.instanceMatrix.needsUpdate=true;
  }
  dispose(){this.mesh.dispose();this.geometry.dispose();this.material.dispose();}
}
