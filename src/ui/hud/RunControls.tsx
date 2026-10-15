'use client';

import type { SimBridge } from '../../bridge/SimBridge';
import { useSceneStore } from '../../bridge/sceneStore';
import { useEditorStore } from '../store/editorStore';
import styles from './Sandbox.module.css';

export function RunControls({bridge,onPlay,onEdit,onRestart}:{bridge:SimBridge;onPlay:()=>void;onEdit:()=>void;onRestart:()=>void}) {
  const {playing,speed,tick}=useSceneStore(), mode=useEditorStore(s=>s.mode);
  const seconds=8*3600+tick, day=Math.floor(seconds/86400)+1, time=`${String(Math.floor(seconds/3600)%24).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}`;
  return <div className={styles.transport} aria-label="Run controls">
    <div className={styles.clock} title={`Day ${day} · ${tick} simulated seconds`}>{time}<span style={{fontSize:10,marginLeft:6,color:'#90a5b0'}}>D{day}</span></div>
    <button className={styles.primary} onClick={onPlay} title="Space">{playing?'Ⅱ Pause':'▶ Run'}</button>
    <button disabled={playing||mode==='edit'} onClick={()=>bridge.step(1)} title="Advance one simulated second">+1s</button>
    <div className={styles.row} role="group" aria-label="Simulation speed">{[1,4,16].map(n=><button key={n} aria-pressed={speed===n} onClick={()=>bridge.setSpeed(n)}>{n}×</button>)}</div>
    <button disabled={mode==='edit'} onClick={onRestart} title="Restart this run with the same seed">↻</button>
    {mode!=='edit'&&<button onClick={onEdit}>Pause & edit</button>}
  </div>;
}
