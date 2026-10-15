import { describe, expect, it } from 'vitest';
import { analyseRun } from '../../ai/analysers';
import { cityIndex } from '../../ai/cityIndex';
import { fixtureCity, fixtureRun } from '../../ai/fixtures';
import { topIncidents } from '../replay/afterAction';
import { districtWaits, runReportMarkdown } from './runStats';

describe('dashboard stats', () => {
  it('splits waits and unanswered calls by district', () => {
    expect(districtWaits(fixtureRun(), fixtureCity())).toEqual([
      { name: 'Westbank', mean: 100, served: 1, unmet: 0 },
      { name: 'Eastfield', mean: 400, served: 1, unmet: 1 },
    ]);
  });

  it('writes a one-page report with the disclaimer, incidents and findings', () => {
    const run = fixtureRun();
    const scenario = fixtureCity();
    const md = runReportMarkdown({ run, scenario, analyses: analyseRun(run, cityIndex(scenario)), incidents: topIncidents(run.events), clock: (t) => `t${t}` });
    expect(md).toContain('not an emergency-planning authority');
    expect(md).toContain('**t330 A substation tripped.**');
    expect(md).toContain('Eastfield was cut off');
    expect(md).toContain('| Eastfield | 6.7 min | 1 | 1 |');
    expect(md).toContain('| Route violations (must be 0) | 0 |');
  });
});
