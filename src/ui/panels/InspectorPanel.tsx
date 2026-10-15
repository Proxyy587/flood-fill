'use client';

import { useSceneStore } from '../../bridge/sceneStore';
import styles from '../hud/Sandbox.module.css';

export function InspectorPanel() {
  const { selected, inspector:data, select, focus, follow, overlays, toggleOverlay } = useSceneStore();
  return <section className={styles.section} aria-label="Selection inspector">
    <div className={styles.eyebrow}>Decision explorer</div>
    <h2>{data?.title ?? (selected ? `Loading ${selected.kind} #${selected.id}…` : 'Every decision has a reason.')}</h2>
    {!selected && <p className={styles.muted}>Select a person, vehicle, or building. Inspect its route, assignment, and latest decision.</p>}
    {selected && <div className={styles.row}><button onClick={()=>focus(selected)}>Focus</button><button disabled={selected.kind!=='npc'&&selected.kind!=='vehicle'} onClick={()=>follow(selected)}>Follow</button><button aria-label="Clear selection" onClick={()=>select(null)}>×</button></div>}
    {data && <>
      <dl className={styles.attributes}>{Object.entries(data.attributes).map(([k,v])=><div key={k} style={{display:'contents'}}><dt>{k.replace(/_/g,' ')}</dt><dd>{typeof v==='number'&&!Number.isInteger(v)?v.toFixed(2):v}</dd></div>)}</dl>
      {data.assignment && <p className={styles.muted}>Request #{data.assignment.requestId} · {data.assignment.status} · ETA {data.assignment.eta}s</p>}
      {data.route && <label className={styles.label}><input type="checkbox" checked={overlays.routes} onChange={()=>toggleOverlay('routes')}/> Show route · {data.route.cells.length} cells · version {data.route.version}</label>}
      {data.belief && <p className={styles.muted}>Belief: {data.belief.knownClosures.length} known closures · {data.belief.staleness}s old</p>}
      {data.lastDecision && <div className={styles.decision}><div className={styles.eyebrow}>Decision at +{data.lastDecision.tick}s</div><strong>{data.lastDecision.chosen}</strong><p>{data.lastDecision.reason}</p>{data.lastDecision.alternatives.slice(0,2).map((a,i)=><div className={styles.row} key={`${i}-${a.label}`}><span>{a.label}</span><output style={{textAlign:'right'}}>{a.score.toFixed(2)}</output></div>)}</div>}
      {!data.lastDecision && <p className={styles.muted}>No decision recorded for this selection.</p>}
    </>}
  </section>;
}
