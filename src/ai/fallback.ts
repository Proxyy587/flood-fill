import { BlockType } from '../contracts';
import type { Analysis } from './analysers';
import { DRAIN_RADIUS } from './analysers/hazards';
import type { CityIndex } from './cityIndex';
import { CELL_COST } from './patchCompiler';
import { LIMITATIONS, type CriticReport, type Proposal } from './schema';

const FREE = new Set<number>([BlockType.Grass, BlockType.Dirt, BlockType.Sand, BlockType.Tree]);

/** A complete report from the deterministic analysers alone: the critic works with no key and no network. */
export function fallbackReport(analyses: readonly Analysis[], city: CityIndex, opts: { budget?: number; eco?: boolean } = {}): CriticReport {
  const findings = analyses.flatMap((a) => a.findings).slice(0, 10);
  const proposals: Proposal[] = [];
  for (const a of analyses) {
    const p =
      a.kind === 'drainage'
        ? drainProposal(a, city)
        : a.kind === 'power_cascade'
          ? leveeProposal(a, city)
          : !opts.eco && (a.kind === 'isolated_rooftops' || a.kind === 'isolated_zones')
            ? helipadProposal(a, city)
            : null;
    if (p && (opts.budget === undefined || p.cost <= opts.budget) && !proposals.some((x) => x.title === p.title)) proposals.push(p);
  }
  const top = findings.slice(0, 3).map((f) => f.title.replace(/\.$/, ''));
  const summary = findings.length
    ? `The deterministic analysers flagged ${findings.length} issue${findings.length === 1 ? '' : 's'}. Most serious: ${top.join('; ')}. ` +
      (proposals.length
        ? `${proposals.length} small, cheap change${proposals.length === 1 ? ' is' : 's are'} proposed below; verify each by re-running the storm before trusting it.`
        : 'No executable change is proposed; the issues found need policy changes the editor cannot express yet.')
    : 'The analysers found no gridlock, isolation, hospital overload, power cascade, drainage gap or response gap worth reporting in this run.';
  return {
    summary,
    findings,
    proposals: proposals.slice(0, 4),
    limitations: [...LIMITATIONS, 'Written from rule-based analysers without a language model.'],
  };
}

const cost = (cmds: { block?: number }[]) => cmds.reduce((s, c) => s + (c.block !== undefined ? (CELL_COST[c.block as keyof typeof CELL_COST] ?? 0) : 0), 0);

function drainProposal(a: Analysis, city: CityIndex): Proposal | null {
  const { scenario, w, h } = city;
  const ponds = a.cells.slice();
  const sites: number[] = [];
  const near = (p: number, q: number, r: number) => Math.max(Math.abs((p % w) - (q % w)), Math.abs(Math.floor(p / w) - Math.floor(q / w))) <= r;
  while (ponds.length && sites.length < 6) {
    const pond = ponds[0];
    let site = -1;
    for (let r = 0; r <= 3 && site < 0; r++) {
      for (let dz = -r; dz <= r && site < 0; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const x = (pond % w) + dx;
          const z = Math.floor(pond / w) + dz;
          if (x < 0 || z < 0 || x >= w || z >= h) continue;
          const c = z * w + x;
          if (FREE.has(scenario.blocks[c]) && !sites.includes(c)) {
            site = c;
            break;
          }
        }
    }
    if (site >= 0) sites.push(site);
    for (let i = ponds.length - 1; i >= 0; i--) if (near(ponds[i], site >= 0 ? site : pond, DRAIN_RADIUS)) ponds.splice(i, 1);
  }
  if (!sites.length) return null;
  const commands = sites.map((cell) => ({
    kind: 'setBlock' as const,
    cell,
    block: BlockType.Drainage,
  }));
  const where = city.districtName(sites[0]);
  return {
    id: 'add-drains',
    addresses: a.findings.map((f) => f.id),
    title: `Add ${sites.length} storm drains in ${where}`,
    rationale: `Ponding sites had no drain within ${DRAIN_RADIUS} cells. Each drain is placed on open ground beside a ponding site, never on a road or building.`,
    commands,
    expectedEffect: 'Less standing water near these sites, fewer stalled vehicles and road closures there. A hypothesis until verified.',
    cost: cost(commands),
  };
}

function leveeProposal(a: Analysis, city: CityIndex): Proposal | null {
  const { scenario, w, h } = city;
  const footprint = new Set(a.cells);
  const ring = new Set<number>();
  for (const c of footprint) {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = (c % w) + dx;
        const z = Math.floor(c / w) + dz;
        if (x < 0 || z < 0 || x >= w || z >= h) continue;
        const n = z * w + x;
        if (!footprint.has(n) && FREE.has(scenario.blocks[n])) ring.add(n);
      }
  }
  if (ring.size < 3) return null;
  const commands = [...ring].slice(0, 24).map((cell) => ({
    kind: 'setBlock' as const,
    cell,
    block: BlockType.Levee,
  }));
  const name = a.findings[0]?.title.replace(/ flooded and tripped$/, '') ?? 'the substation';
  return {
    id: 'substation-levee',
    addresses: a.findings.map((f) => f.id),
    title: `Ring ${name} with a levee`,
    rationale: 'The substation tripped when water reached it. A low levee on the open ground around it keeps shallow water out without blocking its road access.',
    commands,
    expectedEffect: 'The substation trips later or not at all, so fewer residents and hospitals lose grid power. A hypothesis until verified.',
    cost: cost(commands),
  };
}

function helipadProposal(a: Analysis, city: CityIndex): Proposal | null {
  const { scenario, w, h } = city;
  const occupied = new Set(scenario.buildings.flatMap((b) => b.cells));
  const free = (c: number) => FREE.has(scenario.blocks[c]) && !occupied.has(c);
  for (const sameDistrict of [true, false])
    for (const anchor of a.cells.slice(0, 12)) {
      for (let r = 0; r <= 6; r++)
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            const x = (anchor % w) + dx;
            const z = Math.floor(anchor / w) + dz;
            if (x < 0 || z < 0 || x + 1 >= w || z + 1 >= h) continue;
            const cells = [z * w + x, z * w + x + 1, (z + 1) * w + x, (z + 1) * w + x + 1];
            if (!cells.every(free)) continue;
            const where = city.districtName(cells[0]);
            if (sameDistrict && where !== city.districtName(anchor)) continue;
            return {
              id: `helipad-${a.kind === 'isolated_zones' ? 'cutoff' : 'rooftops'}`,
              addresses: a.findings.map((f) => f.id),
              title: `Add a helipad in ${where}`,
              rationale: `${a.findings[0]?.title ?? 'People were cut off'}. A landing pad inside the area shortens helicopter round trips when roads are closed.`,
              commands: [
                {
                  kind: 'placeBuilding',
                  def: { type: BlockType.Helipad, cells, entrance: cells[0] },
                },
              ],
              expectedEffect: 'Faster rooftop rescues and fewer people left stranded in this area. A hypothesis until verified.',
              cost: CELL_COST[BlockType.Helipad] * cells.length,
            };
          }
    }
  return null;
}
