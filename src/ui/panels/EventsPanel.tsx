'use client';

import { useSceneStore } from '../../bridge/sceneStore';
import { useSimFeedStore } from '../../bridge/simFeedStore';
import type { SimBridge } from '../../bridge/SimBridge';
import { BlockType, VehicleKind, type InjectedEvent } from '../../contracts';
import { useEditorStore } from '../store/editorStore';
import styles from '../hud/Sandbox.module.css';

const EVENTS: {kind:InjectedEvent['kind'];label:string;type?:BlockType;vehicle?:VehicleKind}[] = [
  {kind:'bridge_closed',label:'Close bridge',type:BlockType.Bridge}, {kind:'boat_failure',label:'Boat failure',vehicle:VehicleKind.Boat},
  {kind:'shelter_overflow',label:'Shelter overflow',type:BlockType.Shelter},{kind:'substation_flooded',label:'Trip substation',type:BlockType.Substation},
  {kind:'road_blocked_by_debris',label:'Block road',type:BlockType.Road},{kind:'false_report',label:'False report'},
  {kind:'comms_outage',label:'Comms outage'},{kind:'helicopter_grounded_wind',label:'Ground helicopters'},
];
export function EventsPanel({bridge}:{bridge:SimBridge}) {
  const scenario=useEditorStore(s=>s.scenario), mode=useEditorStore(s=>s.mode);
  const tick=useSceneStore(s=>s.tick), selected=useSceneStore(s=>s.selected);
  const events=useSimFeedStore(s=>s.events);
  const inject=(event:typeof EVENTS[number])=>{
    const chosen=selected?.kind==='cell'?selected.id:selected?.kind==='building'?scenario?.buildings.find(b=>b.id===selected.id)?.cells[0]:undefined;
    const cell=event.type===undefined?chosen:chosen!==undefined&&scenario?.blocks[chosen]===event.type?chosen:scenario?.blocks.findIndex(b=>b===event.type);
    const snap=bridge.snapshot;
    const building=cell!==undefined?scenario?.buildings.find(b=>b.cells.includes(cell)):undefined;
    const target=event.kind==='shelter_overflow'?building?.id:event.kind==='substation_flooded'?building?.powerNode:undefined;
    const vi=event.vehicle!==undefined?snap?.vehicles.kind.findIndex(k=>k===event.vehicle):undefined;
    bridge.inject({t:tick,kind:event.kind,...(cell!==undefined&&cell>=0?{cell}:{}),...(target!==undefined?{target}:{}),...(vi!==undefined&&vi>=0?{target:snap!.vehicles.id[vi]}:{}),durationTicks:180});
    useEditorStore.setState({notice:`Injected: ${event.label} at +${tick}s.`});
  };
  return <section className={styles.section}><h2>Stress-test controls {scenario?.name.includes('stress')?'· STRESS':''}</h2><p className={styles.muted}>Inject during a run. Cell events use the matching selection or first matching cell.</p><div className={styles.picker}>{EVENTS.map(e=><button key={e.kind} disabled={mode!=='run'||(e.type!==undefined&&!scenario?.blocks.includes(e.type))||(e.vehicle!==undefined&&!bridge.snapshot?.vehicles.kind.includes(e.vehicle))} onClick={()=>inject(e)}>{e.label}</button>)}</div>
    <details className={styles.details}><summary>Recent explanations · {events.length}</summary><ol className={styles.list}>{events.slice(-10).reverse().map((e,i)=><li key={`${e.tick}-${i}`}><strong>+{e.tick}s · {e.type.replace(/_/g,' ')}</strong><br/>{e.reason}</li>)}</ol></details>
  </section>;
}
