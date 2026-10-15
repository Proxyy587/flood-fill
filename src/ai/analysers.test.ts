import { describe, expect, it } from 'vitest';
import { mockRunSummary, mockScenario } from '../contracts/mocks';
import { analyseRun, drainageCoverage, gridlockHotspots, hospitalImbalance, isolatedRooftops, isolatedZones, powerCascade, responseGaps } from './analysers';
import { cityIndex } from './cityIndex';
import { at, fixtureCity, fixtureRun } from './fixtures';
import { FindingSchema } from './schema';

const city = cityIndex(fixtureCity());
const run = fixtureRun();

describe('analysers on the fixture night', () => {
  it('finds the Eastfield gridlock and its duration', () => {
    const a = gridlockHotspots(run, city);
    expect(a.findings[0].title).toContain('Eastfield');
    expect(a.findings[0].explanation).toContain('6 vehicles stalled');
    expect(a.findings[0].evidence.find((e) => e.metric === 'gridlockMinutes')?.value).toBe(4);
    expect(a.cells).toContain(at(15, 10));
  });

  it('finds Eastfield cut off from every hospital and shelter when the junction closes', () => {
    const a = isolatedZones(run, city);
    expect(a.findings).toHaveLength(1);
    expect(a.findings[0].title).toBe('Eastfield was cut off from every hospital and shelter');
    expect(a.evidenceTicks).toEqual([301]);
    expect(a.cells).toContain(at(20, 10));
    expect(a.cells).not.toContain(at(5, 10));
  });

  it('counts only stranded people never served or lifted', () => {
    const a = isolatedRooftops(run, city);
    expect(a.findings[0].explanation).toContain('3 people were stranded');
    expect(a.findings[0].explanation).toContain('1 were never reached');
    expect(a.cells).toEqual([at(18, 4)]);
  });

  it('flags the overloaded hospital against the quiet one', () => {
    const a = hospitalImbalance(run, city);
    expect(a.findings[0].explanation).toMatch(/peaked at 105% of beds/);
    expect(a.findings[0].explanation).toContain('at 10%');
    expect(a.score).toBeGreaterThan(0.6);
  });

  it('traces the substation trip to its blackout and the dry generator', () => {
    const a = powerCascade(run, city);
    expect(a.findings[0].explanation).toContain('200 cells');
    expect(a.findings[0].explanation).toContain('1 backup generator ran dry');
    expect(a.cells).toEqual(fixtureCity().buildings[2].cells);
  });

  it('reports ponding with no drain nearby', () => {
    const a = drainageCoverage(run, city);
    expect(a.findings[0].title).toContain('Westbank');
    expect(a.cells.sort()).toEqual([at(4, 20), at(5, 20)].sort());
  });

  it('ranks Eastfield worst for response, with the run Gini', () => {
    const a = responseGaps(run, city);
    expect(a.findings[0].title).toBe('1 of 2 calls from Eastfield were still unanswered');
    expect(a.findings[0].evidence.find((e) => e.metric === 'gini')?.value).toBe(0.38);
  });

  it('emits schema-valid findings, most severe first', () => {
    const all = analyseRun(run, city);
    expect(all.map((a) => a.kind).sort()).toEqual(['drainage', 'gridlock', 'hospital_imbalance', 'isolated_rooftops', 'isolated_zones', 'power_cascade', 'response_gaps']);
    for (let i = 1; i < all.length; i++) expect(all[i - 1].score).toBeGreaterThanOrEqual(all[i].score);
    for (const f of all.flatMap((a) => a.findings)) expect(() => FindingSchema.parse(f)).not.toThrow();
  });

  it('is quiet on an empty run', () => {
    expect(analyseRun({ ...run, events: [], metrics: [] }, city)).toEqual([]);
  });

  it('produces findings on a real preview run of the riverside city', () => {
    const real = analyseRun(mockRunSummary(1800, 7), cityIndex(mockScenario(7)));
    expect(real.length).toBeGreaterThan(1);
    expect(real.map((a) => a.kind)).toContain('power_cascade');
  });
});
