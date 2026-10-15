'use client';

import { useEffect, useRef, useState } from 'react';
import { ScenarioSchema } from '../../contracts/schemas';
import { citySlot, downloadCity, parseCity, type SavedCity } from '../../editor/persistence';
import { useEditorStore } from '../store/editorStore';
import styles from '../hud/Sandbox.module.css';

export function SavePanel({onTemplate}:{onTemplate:(name:string)=>void}) {
  const { scenario,params,mode,load }=useEditorStore(), file=useRef<HTMLInputElement>(null);
  const [slot,setSlot]=useState('slot-1'), [recovery,setRecovery]=useState<SavedCity|null>(null);
  const [templates,setTemplates]=useState<{id:string;name:string}[]>([]);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    void citySlot('read','autosave').then(value=>{if(active)setRecovery(value);}).catch(()=>{});
    void fetch('/api/templates').then(r=>r.json()).then((value:unknown)=>{
      if(active&&Array.isArray(value))setTemplates(value.filter((x):x is {id:string;name:string}=>typeof x==='object'&&x!==null&&typeof x.id==='string'&&typeof x.name==='string'));
    }).catch(()=>{});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    const timer=setInterval(()=>{
      const s=useEditorStore.getState(); if(s.mode!=='edit'||!s.scenario)return;
      void citySlot('write','autosave',{scenario:s.scenario,params:s.params}).catch(()=>setError('Autosave unavailable. Download a JSON backup.'));
    },30000);
    return()=>clearInterval(timer);
  },[]);
  const restore=(value:SavedCity)=>{useEditorStore.setState({params:value.params});load(value.scenario);setError('');};
  const safely=async(action:()=>Promise<void>)=>{try{await action();setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}};
  return <section className={styles.section}><div className={styles.eyebrow}>Local & synthetic</div><h2>Save your city</h2>
    <label className={styles.label}>Scenario name<input disabled={mode!=='edit'} value={scenario?.name??''} onChange={e=>{if(!scenario)return;const name=e.target.value;useEditorStore.setState(s=>({scenario:{...scenario,name},revision:s.revision+1}));}}/></label>
    <div className={styles.row}><button disabled={!scenario} onClick={()=>scenario&&downloadCity({scenario,params})}>↓ JSON</button><button disabled={mode!=='edit'} onClick={()=>file.current?.click()}>↑ Import</button></div>
    <input ref={file} type="file" accept="application/json,.json" aria-label="Import scenario JSON" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(!f)return;void safely(async()=>{if(f.size>10*1024*1024)throw new Error('File exceeds 10 MB. Choose a smaller scenario.');restore(parseCity(await f.text()));});e.target.value='';}}/>
    <label className={styles.label}>IndexedDB slot<select value={slot} onChange={e=>setSlot(e.target.value)}>{[1,2,3].map(n=><option value={`slot-${n}`} key={n}>City slot {n}</option>)}</select></label>
    <div className={styles.row}><button disabled={!scenario} onClick={()=>void safely(async()=>{if(scenario)await citySlot('write',slot,{scenario,params});useEditorStore.setState({notice:`Saved to ${slot}.`});})}>Save slot</button><button disabled={mode!=='edit'} onClick={()=>void safely(async()=>{const saved=await citySlot('read',slot);if(!saved)throw new Error('This slot is empty. Save a city here first.');restore(saved);})}>Load slot</button></div>
    <p className={styles.muted}>Autosaved locally every 30 seconds while editing. JSON includes NPC settings.</p>
    {recovery&&<div className={styles.warning}>Last session: {recovery.scenario.name}<div className={styles.row}><button disabled={mode!=='edit'} onClick={()=>{restore(recovery);setRecovery(null);}}>Recover</button><button onClick={()=>setRecovery(null)}>Dismiss</button></div></div>}
    <label className={styles.label}>Template<select disabled={mode!=='edit'} defaultValue="" onChange={e=>{const id=e.target.value;if(id.startsWith('demo:'))onTemplate(id);else void safely(async()=>{const response=await fetch(`/api/templates?id=${encodeURIComponent(id)}`);if(!response.ok)throw new Error('Template could not be loaded.');const value=ScenarioSchema.parse(await response.json());load(value);});e.target.value='';}}><option value="" disabled>Choose a synthetic city…</option><option value="demo:riverside">Riverside · preview</option><option value="demo:stress">Compound stress · preview</option>{templates.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select></label>
    {error&&<p className={styles.warning} role="alert">{error}</p>}
    <p className={styles.muted}>Real-city replicas are a later phase. This workspace uses generated data only.</p>
    <a href="/editor-playground" style={{color:'#67dfc6'}}>Open the 2D editor playground ↗</a>
  </section>;
}
