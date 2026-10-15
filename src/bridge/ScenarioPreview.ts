import { asBuildingId, type EntityRef, type InjectedEvent, type InspectorData, type MetricsFrame, type Scenario, type SimEvent } from '../contracts';
import { MockSim } from '../contracts/mocks';

/** MockSim internally indexes buildings by array slot. Keep that implementation
 * detail behind the bridge so deleting a building never changes external IDs. */
export class ScenarioPreview extends MockSim {
  private external: number[];
  constructor(source:Scenario,seed:number,options:ConstructorParameters<typeof MockSim>[2]) {
    const s=structuredClone(source),ids=new Map(s.buildings.map((b,i)=>[b.id,i]));
    s.buildings=s.buildings.map((b,i)=>({...b,id:asBuildingId(i)}));
    s.powerGrid.nodes=s.powerGrid.nodes.map(n=>({...n,...(n.building!==undefined?{building:asBuildingId(ids.get(n.building)??-1)}:{})}));
    s.injected=s.injected.map(e=>e.kind==='shelter_overflow'&&e.target!==undefined?{...e,target:ids.get(asBuildingId(e.target))}:e);
    super(s,seed,options);this.external=source.buildings.map(b=>b.id);
  }
  override world(dirty:number[]=[]){
    const w=super.world(dirty);
    for(let c=0;c<w.buildingIndex.length;c++)if(w.buildingIndex[c])w.buildingIndex[c]=this.external[w.buildingIndex[c]-1]+1;
    return w;
  }
  override inspect(ref:EntityRef):InspectorData|null {
    if(ref.kind!=='building')return super.inspect(ref);
    const index=this.external.indexOf(ref.id);if(index<0)return null;
    const result=super.inspect({...ref,id:index});return result?{...result,id:ref.id}:null;
  }
  override inject(event:InjectedEvent):void {
    if(event.kind==='shelter_overflow'&&event.target!==undefined){
      const index=this.external.indexOf(event.target);
      if(index<0)throw new Error('Shelter target is not in this city.');
      super.inject({...event,target:index});
    }else super.inject(event);
  }
  mapEvent(e:SimEvent):SimEvent {
    return {...e,...(e.actorKind==='building'&&e.actor!==undefined?{actor:asBuildingId(this.external[e.actor])}:{}),...(e.targetKind==='building'&&e.target!==undefined?{target:asBuildingId(this.external[e.target])}:{})};
  }
  mapMetrics(frame:MetricsFrame):MetricsFrame {return {...frame,hospitals:frame.hospitals.map(h=>({...h,id:asBuildingId(this.external[h.id])}))};}
  override drainEvents(){return super.drainEvents().map(e=>this.mapEvent(e));}
  override summary(){const s=super.summary();return {...s,events:s.events.map(e=>this.mapEvent(e)),metrics:s.metrics.map(m=>this.mapMetrics(m))};}
}
