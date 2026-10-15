'use client';

import { useSceneStore } from '../../bridge/sceneStore';
import { useSimFeedStore } from '../../bridge/simFeedStore';
import { useEditorStore } from '../store/editorStore';
import styles from './Sandbox.module.css';

export function LiveHud() {
  const frames=useSimFeedStore(s=>s.metrics), city=useEditorStore(s=>s.scenario);
  const frame=frames.at(-1), weather=useSceneStore(s=>s.weather),tick=useSceneStore(s=>s.tick);
  const cells=city?city.size.w*city.size.h:1;
  return <section className={styles.section}><div className={styles.eyebrow}>Live conditions</div><h2>City pulse <span className={styles.muted}>· +{tick}s</span></h2>
    <div className={styles.stats}>{[
      ['Flooded',frame?`${(frame.floodedCells/cells*100).toFixed(1)}%`:'—'],
      ['Unpowered population',frame?`${frame.unpoweredPopPct.toFixed(1)}%`:'—'],
      ['Stranded',frame?.stranded??'—'],['Helicopter rescues',frame?.heliRescues??'—'],
    ].map(([label,value])=><div className={styles.stat} key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
    <label className={styles.label}><span>Rain <output>{Math.round(weather.rain*100)}%</output></span><progress className={styles.bar} max={1} value={weather.rain}/></label>
    <label className={styles.label}><span>Wind intensity <output>{Math.round(weather.wind*100)}%</output></span><progress className={styles.bar} max={1} value={weather.wind}/></label>
    <p className={styles.muted}>Metrics sampled every 10 simulated seconds{frame?` · last +${frame.tick}s`:''}. Preview values are illustrative.</p>
    {frame?.hospitals.map(h=><div key={h.id}><label className={styles.label}><span>Hospital #{h.id}<output>{Math.round(h.util*100)}%</output></span><progress className={styles.bar} max={1} value={Math.min(1,h.util)}/><small>{h.diversion?'Diverting': 'Accepting'} · {h.onGenerator?'Backup generator active':'Grid power / see inspector'}</small></label></div>)}
  </section>;
}
