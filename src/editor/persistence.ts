import type { NpcParams, Scenario } from '../contracts';
import { NpcParamsSchema, ScenarioSchema } from '../contracts/schemas';
import { z } from 'zod';

const SavedCitySchema = z.object({ scenario: ScenarioSchema, params: NpcParamsSchema });
export interface SavedCity { scenario: Scenario; params: NpcParams }
/** Additional document integrity checks, without changing the shared schema. */
export function checkCity(s:Scenario):void {
  const occupied=new Set<number>(),ids=new Set<number>(),nodes=new Set<number>();
  for(const b of s.buildings){
    if(ids.has(b.id)||b.id>65534)throw new Error('Building IDs must be unique and fit the snapshot ID layer (0–65534).');
    ids.add(b.id);
    for(const c of b.cells){
      if(occupied.has(c))throw new Error(`Building #${b.id} overlaps another footprint or repeats a cell.`);
      if(s.blocks[c]!==b.type)throw new Error(`Building #${b.id} does not match the block at cell ${c}.`);
      occupied.add(c);
    }
  }
  for(const node of s.powerGrid.nodes){
    if(nodes.has(node.id))throw new Error('Power node IDs must be unique.');nodes.add(node.id);
    if(node.cell<0||node.cell>=s.blocks.length)throw new Error(`Power node #${node.id} is outside the city.`);
    if(node.building!==undefined&&!ids.has(node.building))throw new Error(`Power node #${node.id} refers to a missing building.`);
  }
  for(const b of s.buildings)if(b.powerNode!==undefined&&!nodes.has(b.powerNode))throw new Error(`Building #${b.id} refers to a missing power node.`);
  for(const series of [s.weather.rain,s.weather.wind])if(series.some((p,i)=>i>0&&p.t<=series[i-1].t))throw new Error('Weather points must have distinct times in increasing order.');
  if(s.weather.sources.some(p=>p.endT<p.startT))throw new Error('A flood source ends before it starts.');
  if(s.injected.some(e=>e.cell!==undefined&&e.cell>=s.blocks.length))throw new Error('An injected event is outside the city.');
}
export function parseCity(text: string): SavedCity {
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new Error('This file is not valid JSON. Choose a FloodSim scenario.'); }
  const saved = SavedCitySchema.safeParse(input);
  if (saved.success) {checkCity(saved.data.scenario);return saved.data;}
  const result = ScenarioSchema.safeParse(input);
  if (!result.success) {
    const issues = typeof input === 'object' && input !== null && 'scenario' in input ? saved.error.issues : result.error.issues;
    throw new Error(issues.slice(0, 4).map(i => `${i.path.join('.') || 'Scenario'}: ${i.message}`).join('\n'));
  }
  // Raw shared Scenario files remain interoperable; NPC means are stored by the editor wrapper.
  const defaults = NpcParamsSchema.parse({ panicMean: .3, complianceMean: .7, riskToleranceMean: .4, altruismMean: .5, awarenessMean: .6, carOwnership: result.data.population.mix.carOwners, warningDelay: result.data.weather.warningDelay, falseReportRate: .1, commsDelay: 20, staffFatigueRate: .02 });
  checkCity(result.data);
  return { scenario: result.data, params: defaults };
}

export async function citySlot(action: 'read' | 'write', key: string, value?: SavedCity): Promise<SavedCity | null> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('floodsim-editor', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('cities');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Local storage is unavailable. Use JSON download instead.'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('cities', action === 'read' ? 'readonly' : 'readwrite');
      const request = action === 'read' ? tx.objectStore('cities').get(key) : tx.objectStore('cities').put(value, key);
      let result: SavedCity | null = null;
      request.onsuccess = () => {
        try { if (action === 'read' && request.result) result = parseCity(JSON.stringify(request.result)); }
        catch(error) { reject(error); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(new Error('Unable to save this local slot. Download a JSON backup.'));
      tx.onabort = () => reject(new Error('Local storage transaction was interrupted.'));
    });
  } finally { db.close(); }
}
export function downloadCity(value: SavedCity): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url;
  a.download = `${value.scenario.name.replace(/[^a-z0-9_-]/gi, '-')}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
