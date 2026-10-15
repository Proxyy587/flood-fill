import { BlockType, NpcState, VehicleState } from "../contracts/types";
import type { Scenario, DispatchMode, RunOptions, RenderSnapshot, MetricsFrame, RunSummary, SimEvent, EntitySelection, RequestId, VehicleId, BuildingId } from "../contracts/types";
import { DispatchModeSchema, RunOptionsSchema, ScenarioSchema, SeedSchema } from "../contracts/schemas";
import { z } from "zod";
import { createRng } from "./rng";
import { createWorld } from "./world/grid";
import { sampleTimeline } from "./weather/timeline";
import { stepFlood } from "./flood/solver";
import { createPowerState, stepPower } from "./power/grid";
import { createPopulation } from "./agents/population";
import { createAgentSystem, stepAgents, agentSnapshot, inspectAgent } from "./agents/system";
import { createTraffic, gridlockCells } from "./traffic";
import { canEnter } from "./nav/hazards";
import { createReportSystem, injectFalseReport, reportSnapshot, stepReports } from "./reports/system";
import { createIncidentSystem, completeAdmittedIncidents, discoverIncidentAtScene, updateIncidents } from "./dispatch/incidents";
import { admitPatientToHospital, createHospitalSystem, reserveHospitalBed, releaseHospitalReservation, stepExposure } from "./dispatch/hospitals";
import { ambulanceSnapshot, createAmbulances, nearestSafeRoadRoute, planAmbulanceRoute, stepAmbulances } from "./dispatch/ambulances";
import { createHotspotSystem, hotspotZoneForCell, stageIdleAmbulances, updateHotspots } from "./dispatch/hotspots";
import type { HotspotAdmission, HotspotDemand } from "./dispatch/hotspots";
import { runCentralised } from "./dispatch/centralised";
import { runNegotiation } from "./dispatch/negotiation";
import type { DispatchAssignment, DispatchDemand, DispatchUnit } from "./dispatch/policy-common";

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
  const duration = parsed.durationTicks ?? 600; const every = parsed.metricsEvery ?? 10;
  for (const event of scenario.injected) {
    if (event.kind !== "substation_flooded" && event.kind !== "bridge_closed" && event.kind !== "road_blocked_by_debris" && event.kind !== "shelter_overflow" && event.kind !== "false_report" && event.kind !== "comms_outage") throw new Error(`Injected action ${event.kind} not implemented in M3B ambulance runner`);
    if (event.kind === "bridge_closed" && scenario.blocks[event.cell] !== BlockType.Bridge) throw new Error("bridge_closed requires a bridge cell");
    if (event.kind === "road_blocked_by_debris" && scenario.blocks[event.cell] !== BlockType.Road && scenario.blocks[event.cell] !== BlockType.Bridge) throw new Error("road_blocked_by_debris requires a road or bridge cell");
  }
  const world = createWorld(scenario); const power = createPowerState(scenario);
  const rng = createRng(seed);
  const events: SimEvent[] = [{ tick: 0, type: "RUN_STARTED", data: { stage: "dispatch", seed, agentsImplemented: true, evacuationImplemented: true, reportsImplemented: true, dispatchImplemented: true }, reason: "Weather, flood, power, commuting, traffic, evacuation, uncertain reports, ambulance response and hospital balancing are implemented; boats, police and aircraft remain later slices" }];
  const frames: MetricsFrame[] = [];
  let tick = 0; let navVersion = 0; let lastRain = -1; let lastWind = -1;
  const blocked = new Uint8Array(world.water.length);
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
  const hotspots = createHotspotSystem(world.width, world.height);
  const sceneTarget = new Int32Array(incidents.capacity).fill(-1);
  const sceneArrivalTick = new Int32Array(incidents.capacity).fill(-1);
  const patientPickupTarget = new Int32Array(incidents.patientCapacity).fill(-1);
  const loadedForExposure = new Uint8Array(population.civilianCount);

  function demandTasks(): { tasks: DispatchTask[]; demands: DispatchDemand[]; units: DispatchUnit[]; eta: Float64Array } {
    const tasks: DispatchTask[] = [];
    for (let incident = 0; incident < incidents.count; incident++) {
      if (!incidents.active[incident]) continue;
      if (!incidents.discovered[incident]) {
        let assigned = false;
        for (let unit = 0; unit < ambulances.count; unit++) if (ambulances.assignment[unit] === incident) assigned = true;
        if (!assigned) tasks.push({ kind: "scene", incident, patient: -1, targetCell: incidents.estimatedCell[incident] });
      } else {
        for (let patient = 0; patient < incidents.patientCount; patient++) {
          if (incidents.patientIncident[patient] === incident && !hospitals.patientAdmitted[patient] && incidents.patientAssignedUnit[patient] < 0) {
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
        const route = nearestSafeRoadRoute(ambulances.cell[unit], tasks[task].targetCell, world, scenario, blocked);
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
    if (!tasks.length || !units.some((unit) => unit.available)) return;
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
      const route = nearestSafeRoadRoute(ambulances.cell[unit], task.targetCell, world, scenario, blocked);
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
      const destination = reserveHospitalBed(hospitals, patient, incidents.patientHealth[patient], ambulances.cell[unit], world, scenario, blocked);
      if (!destination) {
        if (previousHospital >= 0) events.push({ tick: atTick, type: "HOSPITAL_DIVERT", actor: ambulances.id[unit] as VehicleId, actorKind: "vehicle",
          target: hospitals.id[previousHospital] as BuildingId, targetKind: "building", data: { requestId: incidents.requestId[incidents.patientIncident[patient]] },
          reason: "Reserved hospital became unavailable and no safe accepting bed is reachable; casualty remains with ambulance for retry" });
        continue;
      }
      if (previousHospital < 0) events.push({ tick: atTick, type: "HOSPITAL_ASSIGN", actor: ambulances.id[unit] as VehicleId, actorKind: "vehicle",
        target: destination.hospitalId, targetKind: "building", data: { requestId: incidents.requestId[incidents.patientIncident[patient]], eta: destination.eta }, reason: "Field triage selected and atomically reserved an operational hospital bed" });
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
      if (hospitals.patientAdmitted[patient] || incidents.patientSeverity[patient] !== 2) continue;
      const incident = incidents.patientIncident[patient];
      demand.push({ cell: incidents.estimatedCell[incident], severe: true, uncovered: incidents.patientAssignedUnit[patient] < 0 });
    }
    return demand;
  }

  function metrics(): MetricsFrame {
    let floodedCells = 0; let maxDepth = 0;
    for (const depth of world.water) { if (depth > 0.01) floodedCells++; maxDepth = Math.max(maxDepth, depth); }
    let stranded = 0; let unpowered = 0; let idleCars = 0; let idleAmbulances = 0; let unmet = 0;
    for (let i = 0; i < population.npcs.id.length; i++) {
      if (population.npcs.state[i] === NpcState.SeekHelp || population.npcs.state[i] === NpcState.Stranded) stranded++;
      if (world.powered[population.npcs.cell[i]] === 0) unpowered++;
    }
    for (const state of population.cars.state) if (state === VehicleState.Idle) idleCars++;
    for (let unit = 0; unit < ambulances.count; unit++) if (ambulances.available[unit] && ambulances.state[unit] === VehicleState.Idle && ambulances.assignment[unit] < 0 && ambulances.patientAssignment[unit] < 0) idleAmbulances++;
    for (let incident = 0; incident < incidents.count; incident++) {
      if (!incidents.active[incident]) continue;
      if (!incidents.discovered[incident]) unmet++;
      else for (let patient = 0; patient < incidents.patientCount; patient++) if (incidents.patientIncident[patient] === incident && !hospitals.patientAdmitted[patient]) unmet++;
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
    return { tick, water: world.water.slice(), powered: world.powered.slice(), ...agentsSnapshot,
      vehicles: { id: joinedInt32(agentsSnapshot.vehicles.id, emergency.id), x: joinedFloat32(agentsSnapshot.vehicles.x, emergency.x), z: joinedFloat32(agentsSnapshot.vehicles.z, emergency.z),
        heading: joinedFloat32(agentsSnapshot.vehicles.heading, emergency.heading), kind: joinedUint8(agentsSnapshot.vehicles.kind, emergency.kind), state: joinedUint8(agentsSnapshot.vehicles.state, emergency.state) },
      reports: reportSnapshot(reports),
      dirtyChunks: tick === 0 ? Array.from({ length: Math.ceil(world.width / 16) * Math.ceil(world.height / 16) }, (_, i) => i) : [] };
  }
  function summary(): RunSummary {
    return structuredClone({ scenario: scenario.name, seed, mode, metrics: frames, events, hotspots: [] });
  }
  return {
    get tick() { return tick; }, get done() { return tick >= duration; }, get navVersion() { return navVersion; },
    rng, snapshot, summary, inspect: (selection: EntitySelection) => inspectAgent(agents, selection),
    step() {
      if (tick >= duration) throw new Error("Run has already finished");
      const rain = sampleTimeline(scenario.weather.rain.map((p) => ({ t: p.t, value: p.intensity })), tick);
      const wind = sampleTimeline(scenario.weather.wind.map((p) => ({ t: p.t, value: p.speed })), tick);
      if (rain !== lastRain || wind !== lastWind) events.push({ tick, type: "WEATHER", data: { rain, wind }, reason: `Rain intensity ${rain.toFixed(3)}, wind ${wind.toFixed(3)}m/s` });
      lastRain = rain; lastWind = wind;
      stepFlood(world, { rain: rain * 0.002, sources: scenario.weather.sources, tick });
      applyScheduled(tick + 1);
      applyReportInjections(tick + 1);
      events.push(...stepPower(world, scenario, power, tick + 1));
      updateClosures(tick + 1);
      events.push(...stepAgents(agents, world, scenario, tick + 1, blocked, traffic));
      tick++;
      stepExposure(population, world, loadedForExposure);
      events.push(...stepReports(reports, population, tick, tick < outageUntil));
      events.push(...updateIncidents(incidents, reports, tick));
      const severeAdmissions: HotspotAdmission[] = [];
      dispatchPending(tick);
      processPatientAssignments(tick, severeAdmissions);
      const priorRoutes = ambulances.routes.map((route) => route?.navVersion ?? -1);
      stepAmbulances(ambulances, world, scenario, blocked, navVersion);
      for (let unit = 0; unit < ambulances.count; unit++) if (priorRoutes[unit] >= 0 && priorRoutes[unit] !== navVersion && ambulances.routes[unit]) {
        events.push({ tick, type: "REROUTE", actor: ambulances.id[unit] as VehicleId, actorKind: "vehicle", cell: ambulances.cell[unit],
          data: { navVersion, target: ambulances.target[unit] }, reason: "Ambulance replanned at a safe road node after flood or closure changed the route graph" });
      }
      recoverLostAssignments(tick);
      handleSceneArrivals(tick);
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
