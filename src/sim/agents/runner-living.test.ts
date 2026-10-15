import { expect, it } from "vitest";
import { BlockType, NpcState, RenderSnapshotSchema } from "../../contracts";
import { createSimulation, runBatch } from "../runner";
import { livingFixture } from "./living-fixture";

it("exposes seeded live entities and detached inspector data through the runner", () => {
  const s = livingFixture(); s.population.schedule = "custom"; s.population.customSchedule = { departAt: 0, workTicks: 10 };
  const sim = createSimulation(s, 42, "centralised", { durationTicks: 60 });
  const first = sim.snapshot(); expect(first.npcs.id.length).toBe(12); expect(first.vehicles.id.length).toBe(2);
  sim.step();
  expect(sim.snapshot().npcs.state[0]).toBe(NpcState.Commute);
  expect(RenderSnapshotSchema.safeParse(sim.snapshot()).success).toBe(true);
  const inspector = sim.inspect({ kind: "npc", id: first.npcs.id[0] as never });
  expect(inspector?.lastDecision?.reason).toBeTruthy();
  inspector!.attributes.health = -100;
  expect(sim.inspect({ kind: "npc", id: first.npcs.id[0] as never })?.attributes.health).toBe(100);
  while (!sim.done) sim.step();
  expect(sim.summary().events.some((e) => e.type === "ARRIVED")).toBe(true);
  expect(sim.summary().events[0].data?.agentsImplemented).toBe(true);
  expect(sim.summary().events[0].data?.dispatchImplemented).toBe(false);
});
it("replays living-city multi-seed runs exactly while different seeds change NPC creation", () => {
  const s = livingFixture();
  s.population.schedule = "custom"; s.population.customSchedule = { departAt: 0, workTicks: 10 };
  const options = { durationTicks: 60 };
  const runs = runBatch(s, [0, 42, 77], "centralised", options);
  expect(runs).toEqual(runBatch(s, [0, 42, 77], "centralised", options));
  const a = createSimulation(s, 0, "centralised", options); const b = createSimulation(s, 77, "centralised", options);
  a.step(); b.step(); expect([a.snapshot().npcs.x, a.snapshot().npcs.z]).not.toEqual([b.snapshot().npcs.x, b.snapshot().npcs.z]);
});
it("applies injected road closures before movement and honours raised bridge decks", () => {
  const s = livingFixture(); s.blocks[24] = BlockType.Bridge;
  s.bridges = [{ cell: 24, deckHeight: 2 }];
  s.injected = [{ kind: "bridge_closed", tick: 0, cell: 24 }, { kind: "road_blocked_by_debris", tick: 1, cell: 25 }];
  const sim = createSimulation(s, 42, "centralised", { durationTicks: 2 });
  expect(sim.summary().events.some((e) => e.type === "ROAD_CLOSED" && e.cell === 24 && e.tick === 0)).toBe(true);
  sim.step(); expect(sim.summary().events.some((e) => e.type === "ROAD_CLOSED" && e.cell === 25 && e.tick === 1)).toBe(true);
  expect(sim.navVersion).toBe(2);
});
