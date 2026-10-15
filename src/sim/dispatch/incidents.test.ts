import { expect, it } from "vitest";
import { BlockType, NpcState, ReportStatus } from "../../contracts/types";
import { createPopulation, defaultNpcParams } from "../agents/population";
import { livingFixture } from "../agents/living-fixture";
import { createReportSystem, injectFalseReport, stepReports } from "../reports/system";
import { createIncidentSystem, updateIncidents } from "./incidents";
import { completeAdmittedIncidents, discoverIncidentAtScene } from "./incidents";
import { admitPatientToHospital, createHospitalSystem, reserveHospitalBed } from "./hospitals";
import { createWorld } from "../world/grid";

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

it("field arrival verifies report footprints and discovers each of multiple casualties once", () => {
  const scenario = livingFixture();
  scenario.population.count = 2;
  scenario.blocks[13] = BlockType.Road;
  const population = createPopulation(scenario, 15, { npcParams: { ...defaultNpcParams(scenario), falseReportRate: 0 } });
  const world = createWorld(scenario);
  world.powered[14] = 1;
  const reports = createReportSystem(population, scenario.size.w, scenario.size.h, 15, 2);
  for (let npc = 0; npc < 2; npc++) {
    population.npcs.cell[npc] = 8 + npc;
    population.npcs.state[npc] = NpcState.SeekHelp;
    population.npcs.awareness[npc] = 0;
  }
  injectFalseReport(reports, 8, 1, 0);
  injectFalseReport(reports, 9, 1, 0);
  stepReports(reports, population, 0);
  const incidents = createIncidentSystem(reports);
  updateIncidents(incidents, reports, 0);

  const events = discoverIncidentAtScene(incidents, reports, population, 0, 1);
  expect(incidents.casualtyCount[0]).toBe(2);
  expect(Array.from(incidents.patientNpc.slice(0, 2))).toEqual([0, 1]);
  expect(incidents.patientHealth.slice(0, 2)).toEqual(population.npcs.health.slice(0, 2));
  expect(Array.from(reports.status.slice(0, 2))).toEqual([ReportStatus.Verified, ReportStatus.Verified]);
  expect(events.filter((event) => event.type === "REPORT_VERIFIED")).toHaveLength(2);
  expect(discoverIncidentAtScene(incidents, reports, population, 0, 2)).toEqual([]);
  expect(incidents.casualtyCount[0]).toBe(2);
  const hospitals = createHospitalSystem(scenario, 2);
  const blocked = new Uint8Array(world.water.length);
  expect(reserveHospitalBed(hospitals, 0, incidents.patientHealth[0], 13, world, scenario, blocked)).toBeDefined();
  expect(reserveHospitalBed(hospitals, 1, incidents.patientHealth[1], 13, world, scenario, blocked)).toBeDefined();
  expect(admitPatientToHospital(hospitals, 0)).toBe(true);
  expect(completeAdmittedIncidents(incidents, reports, hospitals, 3)).toEqual([]);
  expect(Array.from(reports.status.slice(0, 2))).toEqual([ReportStatus.Verified, ReportStatus.Verified]);
  expect(admitPatientToHospital(hospitals, 1)).toBe(true);
  expect(completeAdmittedIncidents(incidents, reports, hospitals, 4)).toHaveLength(2);
  expect(Array.from(reports.status.slice(0, 2))).toEqual([ReportStatus.Resolved, ReportStatus.Resolved]);
});

it("closes a false incident without consulting the report's hidden truth flag", () => {
  const { population, reports, incidents } = setup();
  injectFalseReport(reports, 8, 1, 0);
  stepReports(reports, population, 0);
  updateIncidents(incidents, reports, 0);

  const events = discoverIncidentAtScene(incidents, reports, population, 0, 1);
  expect(incidents.casualtyCount[0]).toBe(0);
  expect(incidents.active[0]).toBe(0);
  expect(reports.status[0]).toBe(ReportStatus.False);
  expect(events.filter((event) => event.type === "REPORT_FALSE")).toHaveLength(1);
});

it("does not confirm distress outside the bounded confidence footprint", () => {
  const scenario = livingFixture();
  scenario.population.count = 1;
  const population = createPopulation(scenario, 21, { npcParams: { ...defaultNpcParams(scenario), falseReportRate: 0 } });
  population.npcs.cell[0] = 13;
  population.npcs.state[0] = NpcState.Stranded;
  population.npcs.awareness[0] = 0;
  const reports = createReportSystem(population, scenario.size.w, scenario.size.h, 21, 1);
  injectFalseReport(reports, 8, 0, 0);
  stepReports(reports, population, 0);
  const incidents = createIncidentSystem(reports);
  updateIncidents(incidents, reports, 0);

  discoverIncidentAtScene(incidents, reports, population, 0, 1);
  expect(incidents.casualtyCount[0]).toBe(0);
  expect(reports.status[0]).toBe(ReportStatus.False);
});
