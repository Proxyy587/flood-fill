import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ScenarioSchema } from '../../../src/contracts/schemas';

const Manifest = z.array(z.object({ id:z.string(), name:z.string(), file:z.string() }));
export async function GET(request: Request) {
  try {
    const root=path.join(process.cwd(),'scenarios');
    // Worker 1's future manifest may be an array or {templates:[...]}.
    const raw:unknown=JSON.parse(await readFile(path.join(root,'index.json'),'utf8'));
    const entries=Manifest.parse(raw&&typeof raw==='object'&&'templates' in raw?raw.templates:raw);
    const id=new URL(request.url).searchParams.get('id');
    if(!id)return Response.json(entries.map(({id,name})=>({id,name})));
    const entry=entries.find(e=>e.id===id);if(!entry)return Response.json({error:'Unknown template'},{status:404});
    const file=path.resolve(root,entry.file);
    if(!file.startsWith(root+path.sep)||!file.endsWith('.json'))return Response.json({error:'Invalid template path'},{status:400});
    return Response.json(ScenarioSchema.parse(JSON.parse(await readFile(file,'utf8'))));
  } catch(error) {
    if(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT')return Response.json([]);
    return Response.json({error:'Template manifest or scenario is invalid.'},{status:422});
  }
}
