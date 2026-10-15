import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseManifest, parseTemplate } from '../../../src/worker/templates';

export async function GET(request: Request) {
  try {
    const root = path.join(process.cwd(), 'scenarios');
    const entries = parseManifest(JSON.parse(await readFile(path.join(root, 'index.json'), 'utf8')));
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return Response.json(entries.map(({ id, name, description, size, population, floodKind }) => ({ id, name, description, size, population, floodKind })));
    const entry = entries.find((e) => e.id === id);
    if (!entry) return Response.json({ error: 'Unknown template' }, { status: 404 });
    const file = path.resolve(root, entry.file);
    if (!file.startsWith(root + path.sep) || !file.endsWith('.json')) return Response.json({ error: 'Invalid template path' }, { status: 400 });
    return Response.json(parseTemplate(JSON.parse(await readFile(file, 'utf8'))));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return Response.json([]);
    return Response.json({ error: 'Template manifest or scenario is invalid.' }, { status: 422 });
  }
}
