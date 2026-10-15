import { expect, it } from "vitest";
import { createPopulation, defaultNpcParams } from "../agents/population";
import { livingFixture } from "../agents/living-fixture";
import { createReportSystem, injectFalseReport, stepReports } from "../reports/system";
import { createIncidentSystem, updateIncidents } from "./incidents";

function setup() {
  const scenario = livingFixture();
  scenario.population.count = 1;
  const population = createPopulation(scenario, 42, { npcParams: { ...defaultNpcParams(scenario), falseReportRate: 0 } });
  const reports = createReportSystem(population, scenario.size.w, scenario.size.h, 42, 4);
  return { population, reports, incidents: createIncidentSystem(reports) };
}

it("creates one incident for same-cell and adjacent reports delivered within 30 ticks", () => {
  const { population, reports, incidents } = setup();
  injectFalseReport(reports, 8, 0.4, 0);
  injectFalseReport(reports, 9, 0.8, 20);
  stepReports(reports, population, 20);

  const events = updateIncidents(incidents, reports, 20);
  expect(incidents.count).toBe(1);
  expect(incidents.requestId[0]).toBe(1);
  expect(incidents.reportCount[0]).toBe(2);
  expect(incidents.confidence[0]).toBeCloseTo(0.8);
  expect(events.filter((event) => event.type === "REQUEST_CREATED")).toHaveLength(1);
});

it("creates a new incident when the report correlation window has elapsed", () => {
  const { population, reports, incidents } = setup();
  injectFalseReport(reports, 8, 0.4, 0);
  stepReports(reports, population, 0);
  updateIncidents(incidents, reports, 0);
  injectFalseReport(reports, 8, 0.6, 31);
  stepReports(reports, population, 31);

  updateIncidents(incidents, reports, 31);
  expect(incidents.count).toBe(2);
  expect(Array.from(incidents.requestId.slice(0, 2))).toEqual([1, 2]);
});

it("does not create requests for reports that have not been delivered", () => {
  const { population, reports, incidents } = setup();
  injectFalseReport(reports, 8, 0.4, 0, 5);
  stepReports(reports, population, 0);

  expect(updateIncidents(incidents, reports, 0)).toEqual([]);
  expect(incidents.count).toBe(0);
});

it("retains every report provenance index and is idempotent across updates", () => {
  const { population, reports, incidents } = setup();
  injectFalseReport(reports, 8, 0.4, 0);
  injectFalseReport(reports, 9, 0.7, 5);
  stepReports(reports, population, 5);
  updateIncidents(incidents, reports, 5);
  updateIncidents(incidents, reports, 6);

  expect(incidents.reportCount[0]).toBe(2);
  expect(Array.from(incidents.reportIndices.slice(0, 2))).toEqual([0, 1]);
  expect(incidents.count).toBe(1);
});

it("coalesces provisional requests if a newly delivered report bridges two live clusters", () => {
  const { population, reports, incidents } = setup();
  injectFalseReport(reports, 8, 0.4, 0);
  injectFalseReport(reports, 10, 0.5, 0);
  stepReports(reports, population, 0);
  updateIncidents(incidents, reports, 0);
  expect(incidents.active.slice(0, 2)).toEqual(new Uint8Array([1, 1]));

  injectFalseReport(reports, 9, 0.9, 1);
  stepReports(reports, population, 1);
  updateIncidents(incidents, reports, 1);
  expect(incidents.active.slice(0, 2)).toEqual(new Uint8Array([1, 0]));
  expect(incidents.reportCount[0]).toBe(3);
});
