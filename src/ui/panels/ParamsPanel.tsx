'use client';

import { useRef } from 'react';
import type { FleetDef, NpcParams, Scenario } from '../../contracts';
import { NpcParamsSchema, ScenarioSchema } from '../../contracts/schemas';
import { useEditorStore } from '../store/editorStore';
import styles from '../hud/Sandbox.module.css';

const FIELDS: { key: keyof NpcParams; label: string; max: number; step: number; help: string }[] = [
  { key:'panicMean',label:'Panic',max:1,step:.01,help:'Rises with hazards and crowds; reduces decision quality.' },
  { key:'complianceMean',label:'Compliance',max:1,step:.01,help:'Likelihood of following evacuation and police instructions.' },
  { key:'riskToleranceMean',label:'Risk tolerance',max:1,step:.01,help:'Willingness to wade into water or ignore warnings.' },
  { key:'altruismMean',label:'Altruism',max:1,step:.01,help:'Likelihood of helping, waiting for, or redirecting others.' },
  { key:'awarenessMean',label:'Awareness',max:1,step:.01,help:'How quickly people notice hazards and warnings.' },
  { key:'carOwnership',label:'Car ownership',max:1,step:.01,help:'Share of residents with a car; changes routing mode.' },
  { key:'warningDelay',label:'Warning delay',max:1800,step:10,help:'Simulated seconds after hazard onset before warning.' },
  { key:'falseReportRate',label:'False reports',max:1,step:.01,help:'Probability that an incoming incident report is false.' },
  { key:'commsDelay',label:'Communication delay',max:300,step:1,help:'Simulated seconds before reports reach HQ.' },
  { key:'staffFatigueRate',label:'Staff fatigue rate',max:1,step:.01,help:'Rate of fatigue accumulation; reduces staff effectiveness.' },
];
const PRESETS: Record<string, Partial<NpcParams>> = {
  'Calm and compliant': { panicMean:.1,complianceMean:.95,riskToleranceMean:.15,awarenessMean:.9,falseReportRate:.02,commsDelay:5,warningDelay:30,staffFatigueRate:.01 },
  'Panicky': { panicMean:.9,complianceMean:.3,riskToleranceMean:.8,awarenessMean:.3,falseReportRate:.3,warningDelay:180 },
  'Understaffed': { panicMean:.4,staffFatigueRate:.12,commsDelay:60 },
  'Worst night': { panicMean:.85,complianceMean:.25,awarenessMean:.2,riskToleranceMean:.8,warningDelay:360,commsDelay:120,falseReportRate:.4,staffFatigueRate:.15 },
};
const FLEET_LABELS: Record<keyof FleetDef, string> = { ambulances:'Ambulances',policeCars:'Police cars',boats:'Rescue boats',helicopters:'Helicopters',doctors:'Doctors',nurses:'Nurses',policeOfficers:'Police officers',boatOperators:'Boat operators' };

export function updateScenario(update: (s: Scenario) => void): void {
  const state = useEditorStore.getState(); if (!state.scenario || state.mode !== 'edit') return;
  const scenario = structuredClone(state.scenario); update(scenario);
  const result = ScenarioSchema.safeParse(scenario);
  if (!result.success) { useEditorStore.setState({ notice: result.error.issues[0].message }); return; }
  useEditorStore.setState({ scenario: result.data, revision: state.revision+1, past:[], future:[] });
}

function RainTimeline() {
  const svg = useRef<SVGSVGElement>(null), dragging = useRef<number | null>(null);
  const scenario = useEditorStore(s => s.scenario);
  const disabled = useEditorStore(s => s.mode !== 'edit');
  if (!scenario) return null;
  const points = scenario.weather.rain, maxT = Math.max(3600, ...points.map(p => p.t));
  const move = (clientX: number, clientY: number) => {
    const index = dragging.current, r = svg.current?.getBoundingClientRect();
    if (index === null || !r) return;
    updateScenario(s => {
      const previous = s.weather.rain[index-1]?.t ?? -1, next = s.weather.rain[index+1]?.t ?? maxT+1;
      s.weather.rain[index] = { t: Math.max(previous+1, Math.min(next-1, Math.round(((clientX-r.left)/r.width)*maxT/10)*10)), intensity: Math.max(0,Math.min(1,1-(clientY-r.top)/r.height)) };
    });
  };
  return <>
    <svg ref={svg} className={styles.timeline} viewBox="0 0 240 80" aria-label="Rain timeline; drag a point or edit its labelled inputs below" onPointerMove={e => { if (!disabled) move(e.clientX,e.clientY); }} onPointerUp={() => {dragging.current=null;}} onPointerCancel={() => {dragging.current=null;}}>
      {[20,40,60].map(y=><line key={y} x1={0} x2={240} y1={y} y2={y} stroke="#263b46"/>)}
      <path d={`M0,80 ${points.map(p=>`L${p.t/maxT*240},${80-p.intensity*80}`).join(' ')} L240,80 Z`} fill="#67dfc625"/>
      <polyline points={points.map(p=>`${p.t/maxT*240},${80-p.intensity*80}`).join(' ')} fill="none" stroke="#67dfc6" strokeWidth={2}/>
      {points.map((p,i)=><circle key={i} cx={p.t/maxT*240} cy={80-p.intensity*80} r={5} fill="#67dfc6" onPointerDown={e=>{if(disabled)return; dragging.current=i;svg.current?.setPointerCapture(e.pointerId);}}/>)}
    </svg>
    <p className={styles.muted}>0 → {maxT}s · intensity 0–100%</p>
    {points.map((p,i)=><div className={styles.row} key={i}>
      <label className={styles.label}>Point {i+1} · seconds<input aria-label={`Rain point ${i+1} time`} type="number" min={(points[i-1]?.t ?? -1)+1} max={(points[i+1]?.t ?? maxT+1)-1} step={1} disabled={disabled} value={p.t} onChange={e=>updateScenario(s=>{s.weather.rain[i].t=Math.max((points[i-1]?.t ?? -1)+1,Math.min((points[i+1]?.t ?? maxT+1)-1,+e.target.value));})}/></label>
      <label className={styles.label}>Intensity %<input aria-label={`Rain point ${i+1} intensity`} type="number" min={0} max={100} value={Math.round(p.intensity*100)} disabled={disabled} onChange={e=>updateScenario(s=>{s.weather.rain[i].intensity=Math.max(0,Math.min(100,+e.target.value))/100;})}/></label>
      <button title={`Remove rain point ${i+1}`} aria-label={`Remove rain point ${i+1}`} disabled={disabled || points.length<2} onClick={()=>updateScenario(s=>{s.weather.rain.splice(i,1);})}>×</button>
    </div>)}
    <button disabled={disabled} onClick={()=>updateScenario(s=>{s.weather.rain.push({t:(points.at(-1)?.t ?? 0)+300,intensity:0});})}>+ Add rain point</button>
  </>;
}

export function ParamsPanel() {
  const { scenario, params, setParam, mode } = useEditorStore(), disabled = mode !== 'edit';
  if (!scenario) return null;
  return <>
    <section className={styles.section}><div className={styles.eyebrow}>Scenario laboratory</div><h2>People, resources & weather</h2>
      <label className={styles.label}>Behaviour preset<select disabled={disabled} defaultValue="" onChange={e=>{
        const name=e.target.value; if(!PRESETS[name])return;
        const next=NpcParamsSchema.parse({...useEditorStore.getState().params,...PRESETS[name]});
        useEditorStore.setState({params:next});
        updateScenario(s=>{s.population.mix.carOwners=next.carOwnership;s.weather.warningDelay=next.warningDelay;
          if(name==='Understaffed'||name==='Worst night') {s.fleet={ambulances:1,policeCars:1,boats:1,helicopters:1,doctors:3,nurses:5,policeOfficers:3,boatOperators:2};}
          if(name==='Worst night'){s.weather.floodKind='compound';s.weather.rain=[{t:0,intensity:.6},{t:120,intensity:1},{t:1800,intensity:1}];s.weather.wind=[{t:0,speed:.9}];}
        });
      }}><option value="" disabled>Choose a preset…</option>{Object.keys(PRESETS).map(p=><option key={p}>{p}</option>)}</select></label>
      <label className={styles.label}>Run seed<div className={styles.row}><input aria-label="Run seed" type="number" min={0} max={4294967295} disabled={disabled} value={scenario.defaults.seed} onChange={e=>updateScenario(s=>{s.defaults.seed=Math.max(0,Math.min(4294967295,Math.floor(+e.target.value)));})}/><button disabled={disabled} title="Generate a new seed" onClick={()=>updateScenario(s=>{s.defaults.seed=crypto.getRandomValues(new Uint32Array(1))[0];})}>Shuffle</button></div><small>Same city, settings, and seed reproduce the preview.</small></label>
      <label className={styles.label}>Dispatch policy<select disabled={disabled} value={scenario.defaults.dispatchMode} onChange={e=>updateScenario(s=>{s.defaults.dispatchMode=e.target.value as Scenario['defaults']['dispatchMode'];})}><option value="negotiation">Decentralised negotiation</option><option value="centralised">Centralised baseline</option></select></label>
      <label className={styles.label}>Population<input type="number" min={0} max={1500} disabled={disabled} value={scenario.population.count} onChange={e=>updateScenario(s=>{s.population.count=Math.max(0,Math.min(1500,Math.floor(+e.target.value)));})}/></label>
      <label className={styles.label}>Schedule<select value={scenario.population.schedule} disabled={disabled} onChange={e=>updateScenario(s=>{s.population.schedule=e.target.value as Scenario['population']['schedule'];})}>{['office-hours','night','custom'].map(v=><option key={v}>{v}</option>)}</select></label>
    </section>
    <section className={styles.section}><h2>Behaviour distributions</h2>{FIELDS.map(f=><label className={styles.label} key={f.key}><span>{f.label}<output>{f.max===1?`${Math.round(params[f.key]*100)}%`:`${params[f.key]} s`}</output></span><input type="range" min={0} max={f.max} step={f.step} disabled={disabled} value={params[f.key]} onChange={e=>setParam(f.key,+e.target.value)}/><small>{f.help}</small></label>)}<p className={styles.warning}>Preview engine: not every parameter affects the mock. Production behaviour requires AK’s simulation.</p></section>
    <section className={styles.section}><h2>Fleet & staffing</h2>{Object.entries(FLEET_LABELS).map(([key,label])=><label key={key} className={styles.label}>{label}<input type="number" min={0} max={200} disabled={disabled} value={scenario.fleet[key as keyof FleetDef]} onChange={e=>updateScenario(s=>{s.fleet[key as keyof FleetDef]=Math.max(0,Math.min(200,Math.floor(+e.target.value)));})}/></label>)}</section>
    <section className={styles.section}><h2>Weather & flood</h2><label className={styles.label}>Flood kind<select disabled={disabled} value={scenario.weather.floodKind} onChange={e=>updateScenario(s=>{s.weather.floodKind=e.target.value as Scenario['weather']['floodKind'];})}>{['growing','flash','compound'].map(v=><option key={v}>{v}</option>)}</select></label>
      <label className={styles.label}><span>Wind intensity <output>{Math.round((scenario.weather.wind[0]?.speed??0)*100)}%</output></span><input type="range" min={0} max={1} step={.01} disabled={disabled} value={scenario.weather.wind[0]?.speed??0} onChange={e=>updateScenario(s=>{s.weather.wind=s.weather.wind.length?s.weather.wind.map(p=>({...p,speed:+e.target.value})):[{t:0,speed:+e.target.value}];})}/><small>Normalised 0–1; the contract does not define m/s.</small></label>
      <h3>Rain timeline</h3><RainTimeline/>
    </section>
  </>;
}
