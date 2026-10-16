import { BlockType, NpcState, VehicleState } from "../contracts/types";
import { RAIN_MM_PER_HOUR_AT_FULL } from "../contracts/scenario";
import type { Scenario, DispatchMode, RunOptions, RenderSnapshot, MetricsFrame, RunSummary, SimEvent, EntitySelection, RequestId, VehicleId, BuildingId } from "../contracts/types";
import { DispatchModeSchema, RunOptionsSchema, ScenarioSchema, SeedSchema } from "../contracts/sim-schemas";
import { z } from "zod";
import { createRng } from "./rng";
import { createWorld } from "./world/grid";
import { sampleTimeline } from "./weather/timeline";
import { stepFlood } from "./flood/solver";
import { createPowerState, stepPower } from "./power/grid";
import { createPopulation } from "./agents/population";
import { createAgentSystem, stepAgents, agentSnapshot, inspectAgent } from "./agents/system";
import { createTraffic, gridlockCells } from "./traffic";
import { buildHazardGrid, canEnter } from "./nav/hazards";
import { buildFlowField, findPath } from "./nav";
import { createReportSystem, injectFalseReport, reportSnapshot, stepReports } from "./reports/system";
import { createIncidentSystem, completeAdmittedIncidents, discoverIncidentAtScene, updateIncidents } from "./dispatch/incidents";
import { admitPatientToHospital, createHospitalSystem, reserveHospitalBed, releaseHospitalReservation, stepExposure, triageHealth } from "./dispatch/hospitals";
import { ambulanceSnapshot, createAmbulances, nearestSafeRoadRoute, planAmbulanceRoute, stepAmbulances } from "./dispatch/ambulances";
import { createHotspotSystem, hotspotZoneForCell, stageIdleAmbulances, updateHotspots } from "./dispatch/hotspots";
import type { HotspotAdmission, HotspotDemand } from "./dispatch/hotspots";
import { runCentralised } from "./dispatch/centralised";
import { runNegotiation } from "./dispatch/negotiation";
import type { DispatchAssignment, DispatchDemand, DispatchUnit } from "./dispatch/policy-common";
import { boatSnapshot, createBoats, loadBoatPassenger, planBoatRoute, stepBoats, BOAT_SEATS } from "./dispatch/boats";
import { createPolice, policeSnapshot, stepPolice } from "./dispatch/police";
import { createEscortSystem, escortCandidates, stepEscortGroups } from "./dispatch/police-escort";
import { createCrowdControl, stepCrowdControl } from "./dispatch/police-crowd";
import { handoffRescuedCivilian, reserveRescuedShelter, releaseRescuedShelter, markRescuedAboard, requeueFailedRescue } from "./agents/system";

export const SIM_CAPABILITIES = { weather: true, flood: true, power: true, agents: true, commuting: true, traffic: true, evacuation: true, reports: true, dispatch: true, hospitals: true, aircraft: false } as const;
/** Compatibility alias for existing headless clients. */
export const FOUNDATION_CAPABILITIES = SIM_CAPABILITIES;

type DispatchTask = { kind: "scene" | "patient"; incident: number; patient: number; targetCell: number };

function joinedInt32(first: Int32Array, second: Int32Array): Int32Array {
  const joined = new Int32Array(first.length + second.length); joined.set(first); joined.set(second, first.length); return joined;
}
function joinedFloat32(first: Float32Array, second: Float32Array): Float32Array {
  const joined = new Float32Array(first.length + second.length); joined.set(first); joined.set(second, first.length); return joined;
}
function joinedUint8(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.length + second.length); joined.set(first); joined.set(second, first.length); return joined;
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

/** Same core API for Node batch execution and AJ's browser worker adapter. */
export function createSimulation(input: Scenario, seedInput: number, modeInput: DispatchMode, options: RunOptions = {}) {
  const scenario = ScenarioSchema.parse(input); const seed = SeedSchema.parse(seedInput);
  const mode = DispatchModeSchema.parse(modeInput); const parsed = RunOptionsSchema.parse(options);
  const layaTape = parsed.layaTape?.seed === seed && parsed.layaTape.dispatchMode === mode ? parsed.layaTape : undefined;
  const duration = parsed.durationTicks ?? 600; const every = parsed.metricsEvery ?? 10;
  for (const event of scenario.injected) {
    if (event.kind !== "substation_flooded" && event.kind !== "bridge_closed" && event.kind !== "road_blocked_by_debris" && event.kind !== "shelter_overflow" && event.kind !== "false_report" && event.kind !== "comms_outage" && event.kind !== "boat_failure") throw new Error(`Injected action ${event.kind} not implemented in M3C boat runner`);
    if (event.kind === "bridge_closed" && scenario.blocks[event.cell] !== BlockType.Bridge) throw new Error("bridge_closed requires a bridge cell");
    if (event.kind === "road_blocked_by_debris" && scenario.blocks[event.cell] !== BlockType.Road && scenario.blocks[event.cell] !== BlockType.Bridge) throw new Error("road_blocked_by_debris requires a road or bridge cell");
  }
  const world = createWorld(scenario); const power = createPowerState(scenario);
  const rng = createRng(seed);
  const events: SimEvent[] = [{ tick: 0, type: "RUN_STARTED", data: { stage: "dispatch", seed, agentsImplemented: true, evacuationImplemented: true, reportsImplemented: true, dispatchImplemented: true,
    ...(layaTape ? { layaVersion: layaTape.version, layaModelRevision: layaTape.modelRevision, layaScenarioFingerprint: layaTape.scenarioFingerprint,
      layaDispatchMode: layaTape.dispatchMode, layaHospitalMinor: layaTape.hospitalPreference.minor ?? 0,
      layaHospitalModerate: layaTape.hospitalPreference.moderate ?? 0, layaHospitalSevere: layaTape.hospitalPreference.severe ?? 0 } : {}) },
    reason: layaTape ? "Run started with recorded Laya dispatch and hospital preferences; simulator safety checks remain authoritative" :
      "Weather, flood, power, commuting, evacuation, reports, ambulance and boat rescue, shelter handoff, hospital balancing, police gridlock control and civilian escort are implemented; crowd control and aircraft remain follow-ons" }];
  const frames: MetricsFrame[] = [];
  let tick = 0; let navVersion = 0; let lastRain = -1; let lastWind = -1;
  const blocked = new Uint8Array(world.water.length);
  const boats = createBoats(scenario, world, blocked);
  const boatLandingWaterTarget = new Int32Array(boats.count).fill(-1);
  const boatTaskTarget = new Int32Array(boats.count).fill(-1);
  const closed = new Uint8Array(world.water.length);
  function applyScheduled(boundary: number) {
    for (const event of scenario.injected) if (event.tick === boundary) {
      if (event.kind === "bridge_closed" || event.kind === "road_blocked_by_debris") {
        blocked[event.cell] = 1;
        events.push({ tick: boundary, type: "INJECTED", cell: event.cell, data: { kind: event.kind }, reason: "Scheduled synthetic permanent road closure" });
      } else if (event.kind === "shelter_overflow") {
        const shelter = scenario.buildings.find((building) => building.id === event.buildingId)!;
        shelter.capacity = 0;
        events.push({ tick: boundary, type: "INJECTED", actor: event.buildingId, actorKind: "building", data: { kind: event.kind }, reason: "Scheduled synthetic shelter capacity failure" });
        events.push({ tick: boundary, type: "SHELTER_OVERFLOW", actor: event.buildingId, actorKind: "building", reason: "Shelter failed and can accept no further evacuees" });
      } else if (event.kind === "substation_flooded") {
        events.push({ tick: boundary, type: "INJECTED", data: { kind: event.kind, nodeId: event.nodeId }, reason: "Scheduled synthetic substation flood fault" });
        if (!power.tripped.has(event.nodeId)) {
          power.tripped.add(event.nodeId);
          events.push({ tick: boundary, type: "POWER_TRIP", data: { nodeId: event.nodeId }, reason: "Substation latched off by injected flood fault" });
        }
      } else if (event.kind === "boat_failure") {
        const boat = Array.from(boats.id).indexOf(event.vehicleId);
        if (boat < 0) {
          events.push({ tick: boundary, type: "INJECTED", actor: event.vehicleId, actorKind: "vehicle", data: { kind: event.kind, operational: false },
            reason: "Scheduled boat failure targets a configured vessel without an operator; no operational unit is affected" });
          continue;
        }
        boats.available[boat] = 0;
        boats.state[boat] = VehicleState.Failed;
        boats.routes[boat] = null;
        const incident = boats.assignment[boat];
        boats.assignment[boat] = -1;
        boatTaskTarget[boat] = -1;
        boatLandingWaterTarget[boat] = -1;
        for (let slot = 0; slot < boats.passengerCount[boat]; slot++) {
          const patient = boats.passengers[boat * BOAT_SEATS + slot];
          if (patient < 0) continue;
          const npc = incidents.patientNpc[patient];
          releaseRescuedShelter(agents, npc);
          requeueFailedRescue(agents, npc);
          patientBoatAssignment[patient] = -1;
          patientBoatTransported[patient] = 0;
          incidents.patientCell[patient] = boats.cell[boat];
          population.npcs.cell[npc] = boats.cell[boat];
          population.npcs.x[npc] = boats.x[boat];
          population.npcs.z[npc] = boats.z[boat];
          boats.passengers[boat * BOAT_SEATS + slot] = -1;
        }
        boats.passengerCount[boat] = 0;
        events.push({ tick: boundary, type: "INJECTED", actor: event.vehicleId, actorKind: "vehicle", data: { kind: event.kind }, reason: "Scheduled synthetic boat failure" });
        if (incident >= 0) events.push({ tick: boundary, type: "COMMIT_CANCELLED", actor: event.vehicleId, actorKind: "vehicle",
          target: incidents.requestId[incident] as RequestId, targetKind: "request", reason: "Boat failed; incident remains queued for another eligible responder" });
      }
    }
  }
  function updateClosures(boundary: number) {
    for (let cell = 0; cell < world.water.length; cell++) {
      if (world.block[cell] !== BlockType.Road && world.block[cell] !== BlockType.Bridge) continue;
      const isClosed = canEnter(world, scenario, "car", cell, blocked) ? 0 : 1;
      if (isClosed !== closed[cell]) {
        closed[cell] = isClosed; navVersion++;
        events.push({ tick: boundary, type: isClosed ? "ROAD_CLOSED" : "ROAD_REOPENED", cell, data: { navVersion }, reason: isClosed ? "Car road unavailable due to depth, bridge overtopping or explicit closure" : "Car road reopened within its operating limits" });
      }
    }
  }
  applyScheduled(0);
  events.push(...stepPower(world, scenario, power, 0));
  updateClosures(0);
  const population = createPopulation(scenario, seed, parsed);
  const buildingsById = new Map(scenario.buildings.map((building) => [building.id, building] as const));
  const scheduledFalseCount = scenario.injected.filter((event) => event.kind === "false_report").length;
  const reports = createReportSystem(population, scenario.size.w, scenario.size.h, seed, scheduledFalseCount);
  let outageUntil = 0;
  function applyReportInjections(boundary: number) {
    for (const event of scenario.injected) if (event.tick === boundary) {
      if (event.kind === "false_report") {
        injectFalseReport(reports, event.cell, event.confidence, boundary, population.params.commsDelay);
        events.push({ tick: boundary, type: "INJECTED", cell: event.cell, data: { kind: event.kind }, reason: "Scheduled synthetic unverified report" });
      } else if (event.kind === "comms_outage") {
        outageUntil = Math.max(outageUntil, boundary + event.durationTicks);
        events.push({ tick: boundary, type: "INJECTED", data: { kind: event.kind, until: outageUntil }, reason: "Scheduled synthetic communications outage" });
      }
    }
  }
  applyReportInjections(0);
  const agents = createAgentSystem(population, world, scenario);
  const traffic = createTraffic(world);
  events.push(...population.events);
  events.push(...stepReports(reports, population, 0, 0 < outageUntil));
  const incidents = createIncidentSystem(reports);
  events.push(...updateIncidents(incidents, reports, 0));
  const hospitals = createHospitalSystem(scenario, population.civilianCount);
  const ambulances = createAmbulances(scenario, world, blocked);
  const police = createPolice(scenario, world, blocked);
  const escorts = createEscortSystem(population.civilianCount, world.width);
  const crowdControl = createCrowdControl(world, scenario, blocked);
  const hotspots = createHotspotSystem(world.width, world.height);
  const sceneTarget = new Int32Array(incidents.capacity).fill(-1);
  const sceneWaterTarget = new Int32Array(incidents.capacity).fill(-1);
  const sceneArrivalTick = new Int32Array(incidents.capacity).fill(-1);
  const patientPickupTarget = new Int32Array(incidents.patientCapacity).fill(-1);
  const patientBoatAssignment = new Int32Array(incidents.patientCapacity).fill(-1);
  const patientBoatLanding = new Int32Array(incidents.patientCapacity).fill(-1);
  const patientBoatTransported = new Uint8Array(incidents.patientCapacity);
  const loadedForExposure = new Uint8Array(population.civilianCount);

  function demandTasks(): { tasks: DispatchTask[]; demands: DispatchDemand[]; units: DispatchUnit[]; eta: Float64Array } {
    const tasks: DispatchTask[] = [];
    for (let incident = 0; incident < incidents.count; incident++) {
      if (!incidents.active[incident]) continue;
      if (!incidents.discovered[incident]) {
        let assigned = false;
        for (let unit = 0; unit < ambulances.count; unit++) if (ambulances.assignment[unit] === incident) assigned = true;
        for (let boat = 0; boat < boats.count; boat++) if (boats.assignment[boat] === incident) assigned = true;
        if (!assigned) tasks.push({ kind: "scene", incident, patient: -1, targetCell: incidents.estimatedCell[incident] });
      } else {
        for (let patient = 0; patient < incidents.patientCount; patient++) {
          if (incidents.boatRescue[incident] && incidents.patientHealth[patient] >= 100) continue;
          if (incidents.patientIncident[patient] === incident && !incidents.patientServed[patient] && !hospitals.patientAdmitted[patient] &&
              incidents.patientAssignedUnit[patient] < 0 && patientBoatAssignment[patient] < 0) {
            tasks.push({ kind: "patient", incident, patient, targetCell: incidents.patientCell[patient] });
          }
        }
      }
    }
    const demands: DispatchDemand[] = tasks.map((task) => {
      const cell = task.targetCell;
      const zone = hotspotZoneForCell(hotspots, cell);
      return { id: incidents.requestId[task.incident] as RequestId, cell, createdTick: incidents.createdTick[task.incident], uncoveredCasualties: 1,
        zoneScore: hotspots.score[zone], severityEvidence: task.patient >= 0 ? incidents.patientSeverity[task.patient] : 0 };
    });
    const units: DispatchUnit[] = Array.from({ length: ambulances.count }, (_, unit) => ({ id: ambulances.id[unit] as VehicleId,
      available: Boolean(ambulances.available[unit] && ambulances.state[unit] === VehicleState.Idle && ambulances.assignment[unit] < 0 && ambulances.patientAssignment[unit] < 0) }));
    const eta = new Float64Array(tasks.length * units.length).fill(Infinity);
    for (let task = 0; task < tasks.length; task++) {
      for (let unit = 0; unit < units.length; unit++) {
        if (!units[unit].available) continue;
        const maxAccessDistance = tasks[task].kind === "patient" ? 1 : Math.ceil((1 - incidents.confidence[tasks[task].incident]) * 4) + 1;
        const route = nearestSafeRoadRoute(ambulances.cell[unit], tasks[task].targetCell, world, scenario, blocked, maxAccessDistance);
        if (route) eta[task * units.length + unit] = route.route.length - 1;
      }
    }
    return { tasks, demands, units, eta };
  }

  function releaseSceneAssignment(unit: number, incident: number, atTick: number, reason: string): void {
    ambulances.assignment[unit] = -1;
    ambulances.routes[unit] = null;
    ambulances.target[unit] = -1;
    ambulances.state[unit] = VehicleState.Idle;
    events.push({ tick: atTick, type: "COMMIT_CANCELLED", actor: ambulances.id[unit] as VehicleId, actorKind: "vehicle",
      target: incidents.requestId[incident] as RequestId, targetKind: "request", reason });
  }

  function dispatchPending(atTick: number): void {
    const { tasks, demands, units, eta } = demandTasks();
    if (!tasks.length || !units.some((unit) => unit.available)) { dispatchBoatFallback(atTick); return; }
    let assignments: DispatchAssignment[];
    if (mode === "negotiation") {
      const decisions = runNegotiation(demands, units, eta);
      assignments = decisions.assignments;
      for (const bid of decisions.bids) events.push({ tick: atTick, type: "BID", actor: bid.vehicleId, actorKind: "vehicle", target: bid.requestId, targetKind: "request",
        data: { requestId: bid.requestId, eta: bid.eta, accepted: bid.accepted, round: bid.round }, reason: bid.accepted ? "Ambulance bid accepted by deterministic request arbitration" : "Ambulance bid declined while demand or a better bid prevailed" });
    } else assignments = runCentralised(demands, units, eta).assignments;
    for (const assignment of assignments) {
      const task = tasks[assignment.requestIndex];
      const unit = assignment.unitIndex;
      const maxAccessDistance = task.kind === "patient" ? 1 : Math.ceil((1 - incidents.confidence[task.incident]) * 4) + 1;
      const route = nearestSafeRoadRoute(ambulances.cell[unit], task.targetCell, world, scenario, blocked, maxAccessDistance);
      if (!route) continue;
      if (task.kind === "scene") {
        ambulances.assignment[unit] = task.incident;
        sceneTarget[task.incident] = route.accessCell;
      } else {
        ambulances.patientAssignment[unit] = task.patient;
        incidents.patientAssignedUnit[task.patient] = unit;
        patientPickupTarget[task.patient] = route.accessCell;
      }
      if (!planAmbulanceRoute(ambulances, unit, route.accessCell, world, scenario, blocked, navVersion)) {
        if (task.kind === "scene") ambulances.assignment[unit] = -1;
        else { ambulances.patientAssignment[unit] = -1; incidents.patientAssignedUnit[task.patient] = -1; }
        continue;
      }
      events.push({ tick: atTick, type: "ASSIGNED", actor: assignment.vehicleId, actorKind: "vehicle", target: assignment.requestId, targetKind: "request",
        cell: route.accessCell, data: { requestId: assignment.requestId, eta: assignment.eta, patient: task.patient >= 0 }, reason: task.kind === "scene" ? "Finite ambulance assigned to verify a delivered report incident" : "Finite ambulance assigned to transport one scene-triaged casualty" });
    }
    dispatchBoatFallback(atTick);
  }

  function waterRouteToIncident(boat: number, incident: number): { cell: number; path: Int32Array } | undefined {
    const grid = buildHazardGrid(world, scenario, "boat", blocked);
    const footprint = new Uint8Array(world.water.length);
    for (let offset = incidents.reportStart[incident]; offset < incidents.reportStart[incident] + incidents.reportCount[incident]; offset++) {
      const report = incidents.reportIndices[offset];
      const estimate = reports.estimatedCell[report];
      const radius = Math.ceil((1 - reports.confidence[report]) * 4);
      const ex = estimate % world.width; const ez = Math.floor(estimate / world.width);
      for (let cell = 0; cell < footprint.length; cell++) {
        if (Math.abs(cell % world.width - ex) + Math.abs(Math.floor(cell / world.width) - ez) <= radius + 1) footprint[cell] = 1;
      }
    }
    let best: { cell: number; path: Int32Array } | undefined;
    const field = buildFlowField(grid, [boats.cell[boat]]);
    for (let cell = 0; cell < footprint.length; cell++) {
      if (!footprint[cell] || !grid.passable[cell] || !Number.isFinite(field.distance[cell])) continue;
      if (!best || field.distance[cell] < best.path.length - 1 || field.distance[cell] === best.path.length - 1 && cell < best.cell) {
        const path = findPath(grid, boats.cell[boat], cell);
        if (path) best = { cell, path: Int32Array.from(path) };
      }
    }
    return best;
  }

  function waterRouteToPatient(boat: number, patient: number): { cell: number; path: Int32Array } | undefined {
    const grid = buildHazardGrid(world, scenario, "boat", blocked);
    const field = buildFlowField(grid, [boats.cell[boat]]);
    const targetCell = incidents.patientCell[patient];
    let target = -1;
    let distance = Infinity;
    for (let cell = 0; cell < grid.passable.length; cell++) {
      const near = Math.abs(cell % world.width - targetCell % world.width) + Math.abs(Math.floor(cell / world.width) - Math.floor(targetCell / world.width));
      if (near > 1 || !grid.passable[cell] || !Number.isFinite(field.distance[cell])) continue;
      if (field.distance[cell] < distance || field.distance[cell] === distance && cell < target) { target = cell; distance = field.distance[cell]; }
    }
    if (target < 0) return undefined;
    const path = findPath(grid, boats.cell[boat], target);
    return path ? { cell: target, path: Int32Array.from(path) } : undefined;
  }

  function incidentHasSafeAmbulanceRoute(incident: number): boolean {
    for (let unit = 0; unit < ambulances.count; unit++) {
      if (!ambulances.available[unit]) continue;
      const maxAccessDistance = Math.ceil((1 - incidents.confidence[incident]) * 4) + 1;
      if (nearestSafeRoadRoute(ambulances.cell[unit], incidents.estimatedCell[incident], world, scenario, blocked, maxAccessDistance)) return true;
    }
    return false;
  }

  function dispatchBoatFallback(atTick: number): void {
    for (let incident = 0; incident < incidents.count; incident++) {
      if (!incidents.active[incident]) continue;
      let ambulanceOwnsScene = false;
      for (let unit = 0; unit < ambulances.count; unit++) if (ambulances.assignment[unit] === incident) ambulanceOwnsScene = true;
      if (ambulanceOwnsScene) continue;
      let boatOwnsIncident = false;
      for (let boat = 0; boat < boats.count; boat++) if (boats.assignment[boat] === incident) boatOwnsIncident = true;
      if (boatOwnsIncident) continue;
      const waitingForBoat = !incidents.discovered[incident] || incidents.boatRescue[incident] && Array.from({ length: incidents.patientCount }, (_, patient) => patient)
        .some((patient) => incidents.patientIncident[patient] === incident && !patientBoatTransported[patient] && !hospitals.patientAdmitted[patient]);
      if (!waitingForBoat || !incidents.discovered[incident] && incidentHasSafeAmbulanceRoute(incident)) continue;
      let selected = -1;
      for (let boat = 0; boat < boats.count; boat++) {
        if (boats.available[boat] && boats.state[boat] === VehicleState.Idle && boats.assignment[boat] < 0 && boats.passengerCount[boat] === 0) { selected = boat; break; }
      }
      if (selected < 0) continue;
      let targetPatient = -1;
      if (incidents.discovered[incident]) {
        for (let patient = 0; patient < incidents.patientCount; patient++) if (incidents.patientIncident[patient] === incident && !patientBoatTransported[patient] &&
            !hospitals.patientAdmitted[patient] && patientBoatAssignment[patient] < 0) { targetPatient = patient; break; }
      }
      const route = incidents.discovered[incident] && targetPatient >= 0 ? waterRouteToPatient(selected, targetPatient) : waterRouteToIncident(selected, incident);
      if (!route || !planBoatRoute(boats, selected, route.cell, world, scenario, blocked, navVersion)) continue;
      boats.assignment[selected] = incident;
      boatTaskTarget[selected] = route.cell;
      if (!incidents.discovered[incident]) sceneWaterTarget[incident] = route.cell;
      events.push({ tick: atTick, type: "ASSIGNED", actor: boats.id[selected] as VehicleId, actorKind: "vehicle", target: incidents.requestId[incident] as RequestId,
        cell: route.cell, data: { eta: route.path.length - 1, mode: "boat" }, reason: incidents.discovered[incident] ? "Finite boat assigned for a repeat passenger lift from the incident" : "No safe ambulance route exists; finite boat assigned to verify the delivered report by water" });
    }
  }

  function patientNeedsShelter(patient: number): boolean {
    const npc = incidents.patientNpc[patient];
    const home = scenario.buildings.find((building) => building.id === population.npcs.homeBuilding[npc]);
    return population.npcs.mobility[npc] === 2 || !home || home.cells.some((cell) => world.water[cell] > home.floorHeight);
  }

  function safeLanding(patient: number, fromWater: number): { landing: number; water: number; path: Int32Array; shelter: boolean } | undefined {
    const npc = incidents.patientNpc[patient];
    const injured = incidents.patientHealth[patient] < 100;
    const shelter = !injured && patientNeedsShelter(patient);
    const home = scenario.buildings.find((building) => building.id === population.npcs.homeBuilding[npc]);
    const boatGrid = buildHazardGrid(world, scenario, "boat", blocked);
    const footGrid = buildHazardGrid(world, scenario, "foot", blocked);
    const boatField = buildFlowField(boatGrid, [fromWater]);
    const homeSafe = home && !home.cells.some((cell) => world.water[cell] > home.floorHeight) ? home : undefined;
    const shelterTargets = shelter ? agents.shelters.flatMap((building, index) => {
      const used = agents.shelterAssignment.filter((value) => value === index).length;
      const own = agents.shelterAssignment[npc] === index ? 1 : 0;
      return building.capacity > used - own && !building.cells.some((cell) => world.water[cell] > building.floorHeight) ? [building.entrance] : [];
    }) : [];
    const footTargets = shelter ? shelterTargets : homeSafe ? [homeSafe.entrance] : [];
    const footField = !injured && footTargets.length ? buildFlowField(footGrid, footTargets) : undefined;
    let best: { landing: number; water: number; path: Int32Array; shelter: boolean } | undefined;
    for (let landing = 0; landing < world.water.length; landing++) {
      if (blocked[landing] || world.water[landing] > 0.05 || world.buildingId[landing] !== 0 || world.block[landing] === BlockType.Bridge ||
          world.block[landing] === BlockType.Tree || world.block[landing] === BlockType.Levee || world.block[landing] === BlockType.WaterSource) continue;
      if (injured && (world.block[landing] !== BlockType.Road || !canEnter(world, scenario, "car", landing, blocked))) continue;
      if (!injured && (!footField || !Number.isFinite(footField.distance[landing]))) continue;
      for (const water of [landing - world.width, landing - 1, landing + 1, landing + world.width]) {
        if (water < 0 || water >= world.water.length || Math.abs(water % world.width - landing % world.width) + Math.abs(Math.floor(water / world.width) - Math.floor(landing / world.width)) !== 1 ||
            !boatGrid.passable[water] || !Number.isFinite(boatField.distance[water])) continue;
        if (!best || boatField.distance[water] < best.path.length - 1 || boatField.distance[water] === best.path.length - 1 && (landing < best.landing || landing === best.landing && water < best.water)) {
          const path = findPath(boatGrid, fromWater, water);
          if (path) best = { landing, water, path: Int32Array.from(path), shelter };
        }
      }
    }
    return best;
  }

  function syncBoatPassengers(boat: number): void {
    for (let slot = 0; slot < boats.passengerCount[boat]; slot++) {
      const patient = boats.passengers[boat * BOAT_SEATS + slot];
      if (patient < 0) continue;
      const npc = incidents.patientNpc[patient];
      population.npcs.cell[npc] = boats.cell[boat];
      population.npcs.x[npc] = boats.x[boat];
      population.npcs.z[npc] = boats.z[boat];
      population.npcs.heading[npc] = boats.heading[boat];
    }
  }

  function loadBoatAtScene(boat: number, incident: number, atTick: number): void {
    if (!incidents.discovered[incident]) {
      sceneArrivalTick[incident] = atTick;
      events.push(...discoverIncidentAtScene(incidents, reports, population, incident, atTick, "boat"));
      if (incidents.casualtyCount[incident] === 0) {
        boats.assignment[boat] = -1;
        boats.state[boat] = VehicleState.Idle;
        sceneWaterTarget[incident] = -1;
        return;
      }
    }
    let firstLanding: ReturnType<typeof safeLanding> = undefined;
    for (let patient = 0; patient < incidents.patientCount; patient++) {
      if (incidents.patientIncident[patient] !== incident || patientBoatTransported[patient] || hospitals.patientAdmitted[patient] || patientBoatAssignment[patient] >= 0) continue;
      const patientCell = incidents.patientCell[patient];
      if (Math.abs(patientCell % world.width - boats.cell[boat] % world.width) + Math.abs(Math.floor(patientCell / world.width) - Math.floor(boats.cell[boat] / world.width)) > 1) continue;
      const landing = safeLanding(patient, boats.cell[boat]);
      if (!landing) continue;
      if (!landing.shelter || reserveRescuedShelter(agents, incidents.patientNpc[patient], landing.landing, world, scenario, blocked)) {
        firstLanding = landing;
        break;
      }
    }
    if (!firstLanding) {
      boats.assignment[boat] = -1;
      boats.state[boat] = VehicleState.Idle;
      boats.target[boat] = -1;
      boatTaskTarget[boat] = -1;
      return;
    }
    let loaded = 0;
    for (let patient = 0; patient < incidents.patientCount && loaded < BOAT_SEATS; patient++) {
      if (incidents.patientIncident[patient] !== incident || patientBoatTransported[patient] || hospitals.patientAdmitted[patient] || patientBoatAssignment[patient] >= 0) continue;
      const patientCell = incidents.patientCell[patient];
      if (Math.abs(patientCell % world.width - boats.cell[boat] % world.width) + Math.abs(Math.floor(patientCell / world.width) - Math.floor(boats.cell[boat] / world.width)) > 1) continue;
      const landing = safeLanding(patient, boats.cell[boat]);
      if (!landing || landing.landing !== firstLanding.landing || landing.water !== firstLanding.water) continue;
      if (landing.shelter && !reserveRescuedShelter(agents, incidents.patientNpc[patient], landing.landing, world, scenario, blocked)) continue;
      if (!loadBoatPassenger(boats, boat, patient)) continue;
      patientBoatAssignment[patient] = boat;
      patientBoatLanding[patient] = landing.landing;
      if (incidents.patientHealth[patient] < 100) releaseRescuedShelter(agents, incidents.patientNpc[patient]);
      markRescuedAboard(agents, incidents.patientNpc[patient]);
      if (landing.shelter) {
        const shelterIndex = agents.shelterAssignment[incidents.patientNpc[patient]];
        const shelter = agents.shelters[shelterIndex];
        events.push({ tick: atTick, type: "EVAC_ORDER", actor: population.npcs.id[incidents.patientNpc[patient]] as never, actorKind: "npc",
          target: shelter.id, targetKind: "building", cell: incidents.patientCell[patient], data: { boatRescue: true },
          reason: "Rescue boat boarded a civilian after atomically reserving one reachable shelter place" });
      }
      events.push({ tick: atTick, type: "NPC_STATE", actor: population.npcs.id[incidents.patientNpc[patient]] as never, actorKind: "npc",
        target: boats.id[boat] as VehicleId, targetKind: "vehicle", cell: boats.cell[boat], reason: "Scene-triaged civilian boarded a finite rescue boat after field verification" });
      loaded++;
    }
    if (loaded === 0) {
      boats.assignment[boat] = -1;
      boats.state[boat] = VehicleState.Idle;
      boats.target[boat] = -1;
      boatTaskTarget[boat] = -1;
      return;
    }
    const route = planBoatRoute(boats, boat, firstLanding.water, world, scenario, blocked, navVersion);
    if (!route) {
      for (let slot = 0; slot < loaded; slot++) {
        const patient = boats.passengers[boat * BOAT_SEATS + slot];
        patientBoatAssignment[patient] = -1;
        if (firstLanding.shelter) releaseRescuedShelter(agents, incidents.patientNpc[patient]);
        requeueFailedRescue(agents, incidents.patientNpc[patient]);
        boats.passengers[boat * BOAT_SEATS + slot] = -1;
      }
      boats.passengerCount[boat] = 0;
      boats.assignment[boat] = -1;
      boats.target[boat] = -1;
      boatTaskTarget[boat] = -1;
      return;
    }
    boatLandingWaterTarget[boat] = firstLanding.water;
  }

  function unloadBoatAtShore(boat: number, incident: number, atTick: number): void {
    const waiting: number[] = [];
    for (let slot = 0; slot < boats.passengerCount[boat]; slot++) {
      const patient = boats.passengers[boat * BOAT_SEATS + slot];
      if (patient < 0) continue;
      const npc = incidents.patientNpc[patient];
      const landing = patientBoatLanding[patient];
      if (incidents.patientHealth[patient] < 100) {
        incidents.patientCell[patient] = landing;
        population.npcs.state[npc] = NpcState.SeekHelp;
        population.npcs.cell[npc] = landing;
        population.npcs.x[npc] = landing % world.width + 0.5;
        population.npcs.z[npc] = Math.floor(landing / world.width) + 0.5;
        patientBoatTransported[patient] = 1;
        patientBoatAssignment[patient] = -1;
        boats.passengers[boat * BOAT_SEATS + slot] = -1;
        events.push({ tick: atTick, type: "NPC_STATE", actor: population.npcs.id[npc] as never, actorKind: "npc",
          target: incidents.requestId[incident] as RequestId, targetKind: "request", cell: landing,
          reason: "Field-triaged injured civilian handed off at a safe road-accessible shore for ambulance transport" });
        continue;
      }
      if (!handoffRescuedCivilian(agents, npc, landing, world, scenario, blocked, patientNeedsShelter(patient))) {
        waiting.push(patient);
        continue;
      }
      incidents.patientServed[patient] = 1;
      patientBoatTransported[patient] = 1;
      patientBoatAssignment[patient] = -1;
      boats.passengers[boat * BOAT_SEATS + slot] = -1;
      events.push({ tick: atTick, type: "SERVED", actor: population.npcs.id[npc] as never, actorKind: "npc",
        target: incidents.requestId[incident] as RequestId, targetKind: "request", cell: landing,
        reason: patientNeedsShelter(patient) ? "Uninjured civilian landed safely with one reachable shelter place reserved" : "Uninjured civilian landed safely on a dry shore with a route home" });
    }
    boats.passengerCount[boat] = waiting.length;
    for (let slot = 0; slot < BOAT_SEATS; slot++) boats.passengers[boat * BOAT_SEATS + slot] = waiting[slot] ?? -1;
    if (waiting.length > 0) { boats.state[boat] = VehicleState.Idle; return; }
    boats.passengerCount[boat] = 0;
    for (let slot = 0; slot < BOAT_SEATS; slot++) boats.passengers[boat * BOAT_SEATS + slot] = -1;
    const hasMore = Array.from({ length: incidents.patientCount }, (_, patient) => patient).some((patient) =>
      incidents.patientIncident[patient] === incident && !patientBoatTransported[patient] && !hospitals.patientAdmitted[patient]);
    let nextRoute: ReturnType<typeof waterRouteToPatient>;
    if (hasMore) {
      const patient = Array.from({ length: incidents.patientCount }, (_, index) => index).find((index) => incidents.patientIncident[index] === incident &&
        !patientBoatTransported[index] && !hospitals.patientAdmitted[index] && patientBoatAssignment[index] < 0);
      if (patient !== undefined) nextRoute = waterRouteToPatient(boat, patient);
    }
    if (hasMore && nextRoute && planBoatRoute(boats, boat, nextRoute.cell, world, scenario, blocked, navVersion)) {
      boatTaskTarget[boat] = nextRoute.cell;
      boats.state[boat] = VehicleState.Moving;
    } else {
      boats.assignment[boat] = -1;
      boats.state[boat] = VehicleState.Idle;
      boatLandingWaterTarget[boat] = -1;
      boatTaskTarget[boat] = -1;
    }
  }

  function handleBoatArrivals(atTick: number): void {
    for (let boat = 0; boat < boats.count; boat++) {
      const incident = boats.assignment[boat];
      if (incident < 0) continue;
      syncBoatPassengers(boat);
      if (boats.passengerCount[boat] > 0 && boats.cell[boat] === boatLandingWaterTarget[boat]) {
        unloadBoatAtShore(boat, incident, atTick);
        continue;
      }
      if (boats.passengerCount[boat] === 0 && boats.cell[boat] === boatTaskTarget[boat]) loadBoatAtScene(boat, incident, atTick);
    }
  }

  function recoverLostBoats(atTick: number): void {
    for (let boat = 0; boat < boats.count; boat++) {
      const incident = boats.assignment[boat];
      if (incident < 0 || boats.routes[boat] || boats.state[boat] === VehicleState.Failed) continue;
      const target = boats.passengerCount[boat] > 0 ? boatLandingWaterTarget[boat] : boatTaskTarget[boat];
      if (target >= 0 && boats.cell[boat] === target) continue;
      events.push({ tick: atTick, type: "COMMIT_CANCELLED", actor: boats.id[boat] as VehicleId, actorKind: "vehicle",
        target: incidents.requestId[incident] as RequestId, targetKind: "request", reason: "Boat route became unsafe; passengers and incident remain queued for a safe retry" });
      for (let slot = 0; slot < boats.passengerCount[boat]; slot++) {
        const patient = boats.passengers[boat * BOAT_SEATS + slot];
        if (patient < 0) continue;
        releaseRescuedShelter(agents, incidents.patientNpc[patient]);
        patientBoatAssignment[patient] = -1;
        incidents.patientCell[patient] = boats.cell[boat];
        requeueFailedRescue(agents, incidents.patientNpc[patient]);
      }
      boats.passengerCount[boat] = 0;
      boats.passengers.fill(-1, boat * BOAT_SEATS, (boat + 1) * BOAT_SEATS);
      boats.assignment[boat] = -1;
      boatTaskTarget[boat] = -1;
      boats.routes[boat] = null;
      boats.target[boat] = -1;
      boats.state[boat] = VehicleState.Idle;
    }
  }

  function processPatientAssignments(atTick: number, admissions: HotspotAdmission[]): void {
    loadedForExposure.fill(0);
    for (let patient = 0; patient < incidents.patientCount; patient++) if (incidents.patientLoaded[patient]) {
      const npc = incidents.patientNpc[patient];
      if (npc >= 0) loadedForExposure[npc] = 1;
    }
    for (let unit = 0; unit < ambulances.count; unit++) {
      const patient = ambulances.patientAssignment[unit];
      if (patient < 0 || hospitals.patientAdmitted[patient]) continue;
      const npc = incidents.patientNpc[patient];
      if (incidents.patientLoaded[patient]) {
        population.npcs.cell[npc] = ambulances.cell[unit];
        population.npcs.x[npc] = ambulances.x[unit];
        population.npcs.z[npc] = ambulances.z[unit];
        population.npcs.heading[npc] = ambulances.heading[unit];
      } else {
        const pickup = patientPickupTarget[patient];
        if (ambulances.cell[unit] === pickup) {
          incidents.patientLoaded[patient] = 1;
          loadedForExposure[npc] = 1;
          population.npcs.state[npc] = NpcState.Respond;
          events.push({ tick: atTick, type: "NPC_STATE", actor: population.npcs.id[npc] as never, actorKind: "npc", cell: pickup,
            reason: "Scene-triaged casualty loaded into an assigned ambulance" });
        } else if (!ambulances.routes[unit] && pickup >= 0 && !planAmbulanceRoute(ambulances, unit, pickup, world, scenario, blocked, navVersion)) {
          ambulances.patientAssignment[unit] = -1;
          incidents.patientAssignedUnit[patient] = -1;
          patientPickupTarget[patient] = -1;
          events.push({ tick: atTick, type: "COMMIT_CANCELLED", actor: ambulances.id[unit] as VehicleId, actorKind: "vehicle",
            target: incidents.requestId[incidents.patientIncident[patient]] as RequestId, targetKind: "request", reason: "Casualty approach became unreachable; patient remains queued for another ambulance" });
          continue;
        }
      }
      if (!incidents.patientLoaded[patient]) continue;
      const previousHospital = hospitals.patientReservation[patient];
      const preference = layaTape?.hospitalPreference[triageHealth(incidents.patientHealth[patient])];
      const destination = reserveHospitalBed(hospitals, patient, incidents.patientHealth[patient], ambulances.cell[unit], world, scenario, blocked, preference);
      if (!destination) {
        if (previousHospital >= 0) events.push({ tick: atTick, type: "HOSPITAL_DIVERT", actor: ambulances.id[unit] as VehicleId, actorKind: "vehicle",
          target: hospitals.id[previousHospital] as BuildingId, targetKind: "building", data: { requestId: incidents.requestId[incidents.patientIncident[patient]] },
          reason: "Reserved hospital became unavailable and no safe accepting bed is reachable; casualty remains with ambulance for retry" });
        continue;
      }
      if (previousHospital < 0) events.push({ tick: atTick, type: "HOSPITAL_ASSIGN", actor: ambulances.id[unit] as VehicleId, actorKind: "vehicle",
        target: destination.hospitalId, targetKind: "building", data: { requestId: incidents.requestId[incidents.patientIncident[patient]], eta: destination.eta,
          ...(preference ? { layaPreferredHospital: preference, layaApplied: destination.hospitalId === preference } : {}) },
        reason: preference === destination.hospitalId ? "Recorded Laya preference passed live power, flood, route and capacity checks; bed reserved" :
          preference ? "Laya preference unavailable; deterministic safe hospital fallback reserved a bed" : "Field triage selected and atomically reserved an operational hospital bed" });
      else if (previousHospital !== destination.hospitalIndex) events.push({ tick: atTick, type: "HOSPITAL_DIVERT", actor: ambulances.id[unit] as VehicleId, actorKind: "vehicle",
        target: destination.hospitalId, targetKind: "building", data: { previousHospital: hospitals.id[previousHospital], requestId: incidents.requestId[incidents.patientIncident[patient]] }, reason: "Hospital power, flood safety or route changed; bed reservation diverted to another safe hospital" });
      if (ambulances.cell[unit] === destination.accessCell) {
        if (admitPatientToHospital(hospitals, patient, atTick)) {
          population.npcs.state[npc] = NpcState.Rest;
          ambulances.patientAssignment[unit] = -1;
          ambulances.assignment[unit] = -1;
          incidents.patientAssignedUnit[patient] = -1;
          ambulances.state[unit] = VehicleState.Idle;
          ambulances.routes[unit] = null;
          ambulances.target[unit] = -1;
          admissions.push({ cell: incidents.estimatedCell[incidents.patientIncident[patient]], severe: incidents.patientSeverity[patient] === 2 });
        }
      } else if (!ambulances.routes[unit] || ambulances.target[unit] !== destination.accessCell) {
        if (!planAmbulanceRoute(ambulances, unit, destination.accessCell, world, scenario, blocked, navVersion)) {
          releaseHospitalReservation(hospitals, patient);
          events.push({ tick: atTick, type: "HOSPITAL_DIVERT", actor: ambulances.id[unit] as VehicleId, actorKind: "vehicle",
            target: destination.hospitalId, targetKind: "building", reason: "Hospital route ceased to be safe; reservation released and the loaded casualty remains with the ambulance" });
        }
      }
    }
  }

  function handleSceneArrivals(atTick: number): void {
    for (let unit = 0; unit < ambulances.count; unit++) {
      const incident = ambulances.assignment[unit];
      if (incident < 0 || sceneTarget[incident] < 0 || ambulances.cell[unit] !== sceneTarget[incident]) continue;
      if (sceneArrivalTick[incident] < 0) sceneArrivalTick[incident] = atTick;
      events.push(...discoverIncidentAtScene(incidents, reports, population, incident, atTick));
      ambulances.assignment[unit] = -1;
      if (incidents.casualtyCount[incident] === 0) {
        ambulances.state[unit] = VehicleState.Idle;
        ambulances.routes[unit] = null;
        ambulances.target[unit] = -1;
        continue;
      }
      let patient = -1;
      for (let candidate = 0; candidate < incidents.patientCount; candidate++) {
        if (incidents.patientIncident[candidate] === incident && incidents.patientAssignedUnit[candidate] < 0 && !hospitals.patientAdmitted[candidate]) { patient = candidate; break; }
      }
      if (patient >= 0) {
        ambulances.patientAssignment[unit] = patient;
        incidents.patientAssignedUnit[patient] = unit;
        patientPickupTarget[patient] = ambulances.cell[unit];
        incidents.patientLoaded[patient] = 1;
      } else ambulances.state[unit] = VehicleState.Idle;
    }
  }

  function recoverLostAssignments(atTick: number): void {
    for (let unit = 0; unit < ambulances.count; unit++) {
      const incident = ambulances.assignment[unit];
      if (incident >= 0 && ambulances.cell[unit] !== sceneTarget[incident] && !ambulances.routes[unit]) releaseSceneAssignment(unit, incident, atTick, "Scene route became unreachable after a hazard change; incident re-queued for another safe ambulance");
      const patient = ambulances.patientAssignment[unit];
      if (patient >= 0 && !incidents.patientLoaded[patient] && ambulances.cell[unit] !== patientPickupTarget[patient] && !ambulances.routes[unit]) {
        ambulances.patientAssignment[unit] = -1;
        incidents.patientAssignedUnit[patient] = -1;
        patientPickupTarget[patient] = -1;
        events.push({ tick: atTick, type: "COMMIT_CANCELLED", actor: ambulances.id[unit] as VehicleId, actorKind: "vehicle",
          target: incidents.requestId[incidents.patientIncident[patient]] as RequestId, targetKind: "request", reason: "Casualty route became unsafe; casualty remains queued and will be reassigned" });
      }
    }
  }

  function hotspotDemands(): HotspotDemand[] {
    const demand: HotspotDemand[] = [];
    for (let patient = 0; patient < incidents.patientCount; patient++) {
      if (incidents.patientServed[patient] || hospitals.patientAdmitted[patient] || incidents.patientSeverity[patient] !== 2) continue;
      const incident = incidents.patientIncident[patient];
      demand.push({ cell: incidents.estimatedCell[incident], severe: true, uncovered: incidents.patientAssignedUnit[patient] < 0 });
    }
    return demand;
  }

  function metrics(): MetricsFrame {
    let floodedCells = 0; let maxDepth = 0;
    for (const depth of world.water) { if (depth > 0.01) floodedCells++; maxDepth = Math.max(maxDepth, depth); }
    let stranded = 0; let unpowered = 0; let idleCars = 0; let idleAmbulances = 0; let unmet = 0;
    const buildingPower = new Map(scenario.buildings.map((building) => [building.id, building.cells.some((cell) => world.powered[cell] > 0)] as const));
    for (let i = 0; i < population.npcs.id.length; i++) {
      if (population.npcs.state[i] === NpcState.SeekHelp || population.npcs.state[i] === NpcState.Stranded) stranded++;
      const residence = buildingsById.get(population.npcs.homeBuilding[i] as BuildingId) ?? buildingsById.get(population.npcs.workBuilding[i] as BuildingId);
      const hasPower = residence ? buildingPower.get(residence.id) : world.powered[population.npcs.cell[i]] > 0;
      if (!hasPower) unpowered++;
    }
    for (const state of population.cars.state) if (state === VehicleState.Idle) idleCars++;
    for (let unit = 0; unit < ambulances.count; unit++) if (ambulances.available[unit] && ambulances.state[unit] === VehicleState.Idle && ambulances.assignment[unit] < 0 && ambulances.patientAssignment[unit] < 0) idleAmbulances++;
    for (let incident = 0; incident < incidents.count; incident++) {
      if (!incidents.active[incident]) continue;
      if (!incidents.discovered[incident]) unmet++;
      else for (let patient = 0; patient < incidents.patientCount; patient++) if (incidents.patientIncident[patient] === incident && !incidents.patientServed[patient] && !hospitals.patientAdmitted[patient]) unmet++;
    }
    const tts = Array.from({ length: incidents.count }, (_, incident) => sceneArrivalTick[incident] < 0 ? -1 : sceneArrivalTick[incident] - incidents.createdTick[incident]).filter((value) => value >= 0).sort((a, b) => a - b);
    const districtDelays = new Map<number, { sum: number; count: number }>();
    for (let patient = 0; patient < incidents.patientCount; patient++) {
      const incident = incidents.patientIncident[patient];
      const cell = incidents.estimatedCell[incident];
      let districtId = Infinity;
      for (const district of scenario.districts) if (district.cells.includes(cell) && district.id < districtId) districtId = district.id;
      const key = Number.isFinite(districtId) ? districtId : -1;
      const delay = hospitals.patientAdmitted[patient] ? Math.max(0, hospitals.patientAdmittedTick[patient] - incidents.createdTick[incident]) : Math.max(0, tick - incidents.createdTick[incident]);
      const current = districtDelays.get(key) ?? { sum: 0, count: 0 };
      current.sum += delay; current.count++; districtDelays.set(key, current);
    }
    const means = [...districtDelays.values()].map((value) => value.sum / value.count);
    const totalMean = means.reduce((sum, value) => sum + value, 0) / Math.max(1, means.length);
    const gini = means.length <= 1 || totalMean === 0 ? 0 : means.reduce((sum, a) => sum + means.reduce((inner, b) => inner + Math.abs(a - b), 0), 0) / (2 * means.length * means.length * totalMean);
    const hospitalById = new Map(Array.from({ length: hospitals.count }, (_, index) => [hospitals.id[index], index] as const));
    const hospitalMetrics = scenario.buildings.filter((building) => building.type === BlockType.Hospital).sort((a, b) => a.id - b.id).map((building) => {
      const index = hospitalById.get(building.id)!;
      return { id: building.id, util: hospitals.capacity[index] > 0 ? (hospitals.occupied[index] + hospitals.reserved[index]) / hospitals.capacity[index] : 0,
        diversion: power.diversion.has(building.id), onGenerator: world.powered[building.entrance] === 2 };
    });
    return { tick, tts: { mean: tts.length ? tts.reduce((sum, value) => sum + value, 0) / tts.length : 0, p50: quantile(tts, 0.5), p90: quantile(tts, 0.9) },
      unmet, idleFrac: { ...(population.cars.id.length ? { car: idleCars / population.cars.id.length } : {}), ...(ambulances.count ? { ambulance: idleAmbulances / ambulances.count } : {}) }, gini,
      hospitals: hospitalMetrics,
      evacDonePct: population.civilianCount > 0 ? population.npcs.state.slice(0, population.civilianCount).filter((state) => state === NpcState.ShelterInPlace).length / population.civilianCount * 100 : 0,
      stranded, gridlockCells: gridlockCells(traffic), floodedCells, maxDepth,
      unpoweredPopPct: population.npcs.id.length ? unpowered / population.npcs.id.length * 100 : 0,
      heliRescues: 0, routeViolations: 0 };
  }
  frames.push(metrics());
  function snapshot(): RenderSnapshot {
    const agentsSnapshot = agentSnapshot(agents);
    const emergency = ambulanceSnapshot(ambulances);
    const policeVehicles = policeSnapshot(police);
    const rescueBoats = boatSnapshot(boats);
    const responseIds = joinedInt32(joinedInt32(emergency.id, policeVehicles.id), rescueBoats.id);
    const responseX = joinedFloat32(joinedFloat32(emergency.x, policeVehicles.x), rescueBoats.x);
    const responseZ = joinedFloat32(joinedFloat32(emergency.z, policeVehicles.z), rescueBoats.z);
    const responseHeading = joinedFloat32(joinedFloat32(emergency.heading, policeVehicles.heading), rescueBoats.heading);
    const responseKind = joinedUint8(joinedUint8(emergency.kind, policeVehicles.kind), rescueBoats.kind);
    const responseState = joinedUint8(joinedUint8(emergency.state, policeVehicles.state), rescueBoats.state);
    return { tick, water: world.water.slice(), powered: world.powered.slice(), ...agentsSnapshot,
      vehicles: { id: joinedInt32(agentsSnapshot.vehicles.id, responseIds), x: joinedFloat32(agentsSnapshot.vehicles.x, responseX), z: joinedFloat32(agentsSnapshot.vehicles.z, responseZ),
        heading: joinedFloat32(agentsSnapshot.vehicles.heading, responseHeading), kind: joinedUint8(agentsSnapshot.vehicles.kind, responseKind), state: joinedUint8(agentsSnapshot.vehicles.state, responseState) },
      reports: reportSnapshot(reports),
      dirtyChunks: tick === 0 ? Array.from({ length: Math.ceil(world.width / 16) * Math.ceil(world.height / 16) }, (_, i) => i) : [] };
  }
  function summary(): RunSummary {
    return structuredClone({ scenario: scenario.name, seed, mode, metrics: frames, events, hotspots: [] });
  }
  return {
    get tick() { return tick; }, get done() { return tick >= duration; }, get navVersion() { return navVersion; },
    rng, snapshot, summary,
    updatesSince(eventOffset: number, metricOffset: number) {
      if (!Number.isInteger(eventOffset) || eventOffset < 0 || !Number.isInteger(metricOffset) || metricOffset < 0) throw new RangeError("Update offsets must be nonnegative integers");
      return structuredClone({ events: events.slice(eventOffset), metrics: frames.slice(metricOffset) });
    },
    inspect: (selection: EntitySelection) => inspectAgent(agents, selection),
    step() {
      if (tick >= duration) throw new Error("Run has already finished");
      const rain = sampleTimeline(scenario.weather.rain.map((p) => ({ t: p.t, value: p.intensity })), tick);
      const wind = sampleTimeline(scenario.weather.wind.map((p) => ({ t: p.t, value: p.speed })), tick);
      if (rain !== lastRain || wind !== lastWind) events.push({ tick, type: "WEATHER", data: { rain, wind }, reason: `Rain intensity ${rain.toFixed(3)}, wind ${wind.toFixed(3)}m/s` });
      lastRain = rain; lastWind = wind;
      stepFlood(world, { rain: rain * RAIN_MM_PER_HOUR_AT_FULL / 1_000 / 3_600, sources: scenario.weather.sources, tick });
      applyScheduled(tick + 1);
      applyReportInjections(tick + 1);
      events.push(...stepPower(world, scenario, power, tick + 1));
      updateClosures(tick + 1);
      const groups = stepEscortGroups(escorts, agents, tick + 1);
      const escortTasks = escortCandidates(groups, agents, world, scenario, blocked, police.cell);
      const crowdStep = stepCrowdControl(crowdControl, agents, world, scenario, blocked, navVersion, tick + 1, police.cell);
      const policeStep = stepPolice(police, traffic, world, scenario, blocked, navVersion, tick + 1, escortTasks, crowdStep.candidates);
      events.push(...policeStep.events);
      events.push(...stepAgents(agents, world, scenario, tick + 1, blocked, traffic, policeStep.controlled, policeStep.escortGuidance, policeStep.crowdGuidance));
      tick++;
      stepExposure(population, world, loadedForExposure);
      events.push(...stepReports(reports, population, tick, tick < outageUntil));
      events.push(...updateIncidents(incidents, reports, tick));
      const severeAdmissions: HotspotAdmission[] = [];
      dispatchPending(tick);
      processPatientAssignments(tick, severeAdmissions);
      const priorRoutes = ambulances.routes.map((route) => route?.navVersion ?? -1);
      const priorBoatRoutes = boats.routes.map((route) => route?.navVersion ?? -1);
      stepAmbulances(ambulances, world, scenario, blocked, navVersion);
      stepBoats(boats, world, scenario, blocked, navVersion);
      for (let unit = 0; unit < ambulances.count; unit++) if (priorRoutes[unit] >= 0 && priorRoutes[unit] !== navVersion && ambulances.routes[unit]) {
        events.push({ tick, type: "REROUTE", actor: ambulances.id[unit] as VehicleId, actorKind: "vehicle", cell: ambulances.cell[unit],
          data: { navVersion, target: ambulances.target[unit] }, reason: "Ambulance replanned at a safe road node after flood or closure changed the route graph" });
      }
      for (let boat = 0; boat < boats.count; boat++) if (priorBoatRoutes[boat] >= 0 && priorBoatRoutes[boat] !== navVersion && boats.routes[boat]) {
        events.push({ tick, type: "REROUTE", actor: boats.id[boat] as VehicleId, actorKind: "vehicle", cell: boats.target[boat],
          data: { navVersion, mode: "boat" }, reason: "Boat replanned after hazards changed its water route graph" });
      }
      recoverLostAssignments(tick);
      recoverLostBoats(tick);
      handleSceneArrivals(tick);
      handleBoatArrivals(tick);
      processPatientAssignments(tick, severeAdmissions);
      updateHotspots(hotspots, hotspotDemands(), severeAdmissions, tick);
      dispatchPending(tick);
      processPatientAssignments(tick, severeAdmissions);
      const beforeStage = ambulances.routes.map((route) => route === null);
      stageIdleAmbulances(hotspots, ambulances, hospitals, world, scenario, blocked, navVersion);
      for (let unit = 0; unit < ambulances.count; unit++) if (beforeStage[unit] && ambulances.routes[unit]) {
        events.push({ tick, type: "REROUTE", actor: ambulances.id[unit] as VehicleId, actorKind: "vehicle", cell: ambulances.target[unit],
          data: { staging: true, zoneScore: hotspots.score[hotspotZoneForCell(hotspots, ambulances.target[unit])] }, reason: "Idle ambulance staged toward the highest-scoring severe-demand hot zone" });
      }
      events.push(...completeAdmittedIncidents(incidents, reports, hospitals, tick));
      if (tick % every === 0 || tick === duration) frames.push(metrics());
      if (tick === duration) events.push({ tick, type: "RUN_FINISHED", reason: `Completed ${duration} deterministic simulation seconds` });
    },
  };
}

export function runBatch(scenario: Scenario, seeds: readonly number[], mode: DispatchMode, options: RunOptions = {}): RunSummary[] {
  ScenarioSchema.parse(scenario); DispatchModeSchema.parse(mode); RunOptionsSchema.parse(options);
  const validatedSeeds = z.array(SeedSchema).max(1000).parse(seeds);
  return validatedSeeds.map((seed) => {
    const simulation = createSimulation(scenario, seed, mode, options);
    while (!simulation.done) simulation.step();
    return simulation.summary();
  });
}
