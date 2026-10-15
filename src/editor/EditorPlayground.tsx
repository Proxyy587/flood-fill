'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BlockType, type Scenario } from '../contracts';
import { mockScenario } from '../contracts/mocks';
import { InspectorPanel } from '../ui/panels/InspectorPanel';
import { EditorPanel, Hotbar, blockColor } from '../ui/panels/EditorPanel';
import { ParamsPanel } from '../ui/panels/ParamsPanel';
import { SavePanel } from '../ui/panels/SavePanel';
import { useEditorStore } from '../ui/store/editorStore';
import { useSceneStore } from '../bridge/sceneStore';
import { commitGesture, previewGesture } from './gestures';
import styles from '../ui/hud/Sandbox.module.css';

export function playgroundCity(): Scenario {
  const s=mockScenario();s.name='editor-playground';s.size={w:16,h:16};s.ground=new Array(256).fill(2);s.blocks=new Array(256).fill(BlockType.Grass);
  s.buildings=[];s.districts=[];s.weather.sources=[];s.injected=[];s.population.count=0;s.fleet={ambulances:0,policeCars:0,boats:0,helicopters:0,doctors:0,nurses:0,policeOfficers:0,boatOperators:0};
  s.powerGrid={nodes:[{id:0,kind:'plant',cell:17},{id:1,kind:'substation',cell:20},{id:2,kind:'load',cell:23}],edges:[[0,1]]};
  s.blocks[17]=BlockType.PowerPlant;s.blocks[20]=BlockType.Substation;s.blocks[23]=BlockType.Pole;
  return s;
}

export function EditorPlayground() {
  const {scenario,preview,previewValid,notice}=useEditorStore(), drag=useRef<number[]>([]);
  const [tab,setTab]=useState('build');
  useEffect(()=>{useEditorStore.getState().load(playgroundCity());useSceneStore.setState({selected:null,inspector:null});},[]);
  return <main className={styles.app}><header className={styles.header}><div><h1>Editor playground</h1><p className={styles.muted}>All tools · 16 × 16 fake grid · 1 cell = 4 m · power nodes at (1,1), (4,1), (7,1)</p></div><Link href="/" style={{color:'#67dfc6'}}>Return to 3D city →</Link></header>
    <div className={styles.body}><aside className={styles.rail}><nav className={styles.tabs}>{['build','scenario','files'].map(t=><button key={t} onClick={()=>setTab(t)} aria-pressed={tab===t}>{t}</button>)}</nav>{tab==='build'?<EditorPanel/>:tab==='scenario'?<ParamsPanel/>:<SavePanel onTemplate={()=>useEditorStore.getState().load(playgroundCity())}/>}</aside>
      <section className={styles.view}><div className={styles.grid} role="group" aria-label="Editable fake grid">{scenario?.blocks.map((block,cell)=><button key={cell} aria-label={`Cell ${cell%16},${Math.floor(cell/16)} ${BlockType[block]}`} style={{background:preview.includes(cell)?(previewValid?'#67dfc6':'#ff7171'):blockColor(block),boxShadow:scenario.ground[cell]!==2?'inset 0 0 0 2px #fff8':undefined}} onPointerDown={e=>{e.preventDefault();drag.current=[cell];}} onPointerEnter={()=>{if(drag.current.length)drag.current.push(cell);const p=previewGesture(drag.current[0]??cell,cell,drag.current.length?drag.current:[cell]);useEditorStore.setState({preview:p.cells,previewValid:!p.errors.length});}} onPointerUp={()=>{
        if(!drag.current.length)return;
        if(useEditorStore.getState().tool==='select'){
          const building=scenario.buildings.find(b=>b.cells.includes(cell));
          useSceneStore.setState({selected:{kind:building?'building':'cell',id:building?.id??cell},inspector:{kind:building?'building':'cell',id:building?.id??cell,title:building?`${BlockType[building.type]} #${building.id}`:`Cell (${cell%16},${Math.floor(cell/16)})`,attributes:{ground:scenario.ground[cell],capacity:building?.capacity??0},lastDecision:{tick:0,chosen:'Editor preview',alternatives:[{label:'Keep current design',score:1},{label:'Change design',score:.5}],reason:'Fake-grid inspector data; no simulation was run.'}}});
        }else commitGesture(drag.current[0],cell,drag.current);
        drag.current=[];
      }} onClick={e=>{if(e.detail===0)commitGesture(cell,cell);}}/> )}</div><div className={styles.viewBottom}><p className={styles.glass} role="status">{notice}</p><Hotbar/></div></section>
      <aside className={`${styles.rail} ${styles.right}`}><InspectorPanel/><p className={styles.muted}>Try road / line, then a hospital beside it, undo, redo, and JSON export/import. Building ghosts show invalid foundations in red. Power clicks connect or disconnect existing nodes.</p><button onClick={()=>useEditorStore.getState().load(playgroundCity())}>Reset fake grid</button></aside>
    </div><footer className={styles.footer}>Synthetic editor harness. Simulation output; not an emergency-planning authority.</footer></main>;
}
