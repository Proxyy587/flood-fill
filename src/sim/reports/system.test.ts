import { expect, it } from "vitest";
import { NpcState } from "../../contracts/types";
import type { SimEvent } from "../../contracts/types";
import { createPopulation, defaultNpcParams } from "../agents/population";
import { createReportSystem, injectFalseReport, reportSnapshot, stepReports } from "./system";
import { livingFixture } from "../agents/living-fixture";

function setup(seed = 42, options: { falseReportRate?: number; commsDelay?: number } = {}) {
  const scenario = livingFixture();
  scenario.population.count = 1;
  const params = { ...defaultNpcParams(scenario), falseReportRate: 0, ...options };
  const population = createPopulation(scenario, seed, { npcParams: params });
  population.npcs.state[0] = NpcState.SeekHelp;
  population.npcs.cell[0] = 9;
  population.npcs.x[0] = 1.5;
  population.npcs.z[0] = 1.5;
  population.npcs.awareness[0] = 1;
  const reports = createReportSystem(population, scenario.size.w, scenario.size.h, seed, 2);
  return { scenario, population, reports };
}

it("creates one report on the civilian distress transition and not on repeated ticks", () => {
  const { population, reports } = setup(42, { commsDelay: 0, falseReportRate: 0 });
  const first = stepReports(reports, population, 4);
  const repeated = stepReports(reports, population, 5);
  expect(reports.count).toBe(1);
  expect(first.filter((event) => event.type === "REPORT_CREATED")).toHaveLength(1);
  expect(repeated.filter((event) => event.type === "REPORT_CREATED")).toHaveLength(0);
});

it("uses awareness as call probability and report confidence", () => {
  const { population, reports } = setup(42, { falseReportRate: 0 });
  population.npcs.awareness[0] = 0;
  stepReports(reports, population, 0);
  expect(reports.count).toBe(0);

  population.npcs.state[0] = NpcState.AtHome;
  stepReports(reports, population, 1);
  population.npcs.awareness[0] = 1;
  population.npcs.state[0] = NpcState.SeekHelp;
  stepReports(reports, population, 2);
  expect(reports.count).toBe(1);
  expect(reports.confidence[0]).toBe(1);
});

it("keeps the estimated cell within the awareness-derived Manhattan error radius", () => {
  const { scenario, population, reports } = setup(1);
  population.npcs.awareness[0] = 0.25;
  stepReports(reports, population, 7);
  const actualX = population.npcs.cell[0] % scenario.size.w;
  const actualZ = Math.floor(population.npcs.cell[0] / scenario.size.w);
  const estimateX = reports.estimatedCell[0] % scenario.size.w;
  const estimateZ = Math.floor(reports.estimatedCell[0] / scenario.size.w);
  expect(Math.abs(estimateX - actualX) + Math.abs(estimateZ - actualZ)).toBeLessThanOrEqual(3);
  expect(reports.confidence[0]).toBe(0.25);
});

it("produces byte-identical report records and events for the same seed", () => {
  const first = setup(77); const second = setup(77);
  const firstEvents = stepReports(first.reports, first.population, 3);
  const secondEvents = stepReports(second.reports, second.population, 3);
  expect(first.reports.estimatedCell.slice(0, first.reports.count)).toEqual(second.reports.estimatedCell.slice(0, second.reports.count));
  expect(first.reports.confidence.slice(0, first.reports.count)).toEqual(second.reports.confidence.slice(0, second.reports.count));
  expect(firstEvents).toEqual(secondEvents);
});

it("draws zero or one anonymous false alarm per civilian according to the configured rate", () => {
  const none = setup(3, { falseReportRate: 0 });
  const all = setup(3, { falseReportRate: 1 });
  none.population.npcs.awareness[0] = 0;
  all.population.npcs.awareness[0] = 0;
  const allEvents: SimEvent[] = [];
  for (let tick = 0; tick < 20; tick++) {
    stepReports(none.reports, none.population, tick);
    allEvents.push(...stepReports(all.reports, all.population, tick));
  }
  expect(none.reports.count).toBe(0);
  expect(all.reports.count).toBe(1);
  expect(all.reports.isFalse[0]).toBe(1);
  expect(reportSnapshot(all.reports).status).toEqual(new Uint8Array([0]));
  expect(allEvents.find((event) => event.type === "REPORT_CREATED")?.actor).toBeUndefined();
  expect(allEvents.find((event) => event.type === "REPORT_CREATED")?.reason).toBe("Unverified distress report delivered with an uncertain location");
});

it("does not deliver before comms delay and holds reports through an outage", () => {
  const { population, reports } = setup(12, { commsDelay: 2 });
  stepReports(reports, population, 0);
  expect(reportSnapshot(reports).confidence).toHaveLength(0);
  expect(stepReports(reports, population, 1, false)).toHaveLength(0);
  expect(stepReports(reports, population, 2, true)).toHaveLength(0);
  expect(reportSnapshot(reports).confidence).toHaveLength(0);
  const delivered = stepReports(reports, population, 5, false);
  expect(delivered.filter((event) => event.type === "REPORT_CREATED")).toHaveLength(1);
  expect(reportSnapshot(reports).confidence).toHaveLength(1);
  expect(reports.belief[reports.estimatedCell[0]]).toBe(1);
});

it("keeps nearby injected reports distinct but caps their cluster belief at maximum confidence", () => {
  const { reports } = setup();
  injectFalseReport(reports, 8, 0.4, 0);
  injectFalseReport(reports, 9, 0.7, 10);
  const { population } = setup();
  population.npcs.state[0] = NpcState.AtHome;
  stepReports(reports, population, 10, false);
  expect(reports.count).toBe(2);
  expect(reportSnapshot(reports).confidence).toEqual(new Float32Array([0.4, 0.7]));
  expect(reports.belief[8]).toBeCloseTo(0.7);
  expect(reports.isFalse.slice(0, 2)).toEqual(new Uint8Array([1, 1]));
});

it("keeps false-alarm RNG independent from true-report location uncertainty", () => {
  const quiet = setup(81, { falseReportRate: 0 });
  const noisy = setup(81, { falseReportRate: 1 });
  quiet.population.npcs.awareness[0] = noisy.population.npcs.awareness[0] = 0.25;
  quiet.population.npcs.state[0] = noisy.population.npcs.state[0] = NpcState.AtHome;
  stepReports(quiet.reports, quiet.population, 0);
  stepReports(noisy.reports, noisy.population, 0);
  quiet.population.npcs.state[0] = noisy.population.npcs.state[0] = NpcState.SeekHelp;
  stepReports(quiet.reports, quiet.population, 1);
  stepReports(noisy.reports, noisy.population, 1);
  const trueQuiet = Array.from(quiet.reports.isFalse.slice(0, quiet.reports.count)).indexOf(0);
  const trueNoisy = Array.from(noisy.reports.isFalse.slice(0, noisy.reports.count)).indexOf(0);
  expect(quiet.reports.estimatedCell[trueQuiet]).toBe(noisy.reports.estimatedCell[trueNoisy]);
});
