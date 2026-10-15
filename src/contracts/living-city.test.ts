import { expect, it } from "vitest";
import { ScenarioSchema, RunOptionsSchema, SimEventSchema } from "./sim-schemas";
import { BlockType } from "./types";
import { mockScenario } from "./mocks/ak";

it("validates explicit bridge decks and rejects wrong/duplicate cells and low decks", () => {
  const s = { ...mockScenario(), bridges: [{ cell: 24, deckHeight: 2 }] };
  s.blocks[24] = BlockType.Bridge;
  expect(ScenarioSchema.safeParse(s).success).toBe(true);
  expect(ScenarioSchema.safeParse({ ...s, bridges: [{ cell: 9, deckHeight: 2 }] }).success).toBe(false);
  expect(ScenarioSchema.safeParse({ ...s, bridges: [s.bridges[0], s.bridges[0]] }).success).toBe(false);
  expect(ScenarioSchema.safeParse({ ...s, bridges: [{ cell: 24, deckHeight: 0 }] }).success).toBe(false);
});
it("requires a usable custom schedule and accepts bounded run start times", () => {
  const s = mockScenario(); s.population.schedule = "custom";
  expect(ScenarioSchema.safeParse(s).success).toBe(false);
  expect(ScenarioSchema.safeParse({ ...s, population: { ...s.population, customSchedule: { departAt: 0, workTicks: 60 } } }).success).toBe(true);
  expect(RunOptionsSchema.safeParse({ startTimeSeconds: 28800 }).success).toBe(true);
  expect(RunOptionsSchema.safeParse({ startTimeSeconds: 86400 }).success).toBe(false);
});
it("accepts typed event actors while preserving legacy logs", () => {
  const e = { tick: 0, type: "REROUTE", actor: 1, actorKind: "npc", reason: "Road closed" };
  expect(SimEventSchema.safeParse(e).success).toBe(true);
  expect(SimEventSchema.safeParse({ ...e, actorKind: "unknown" }).success).toBe(false);
  const { actorKind: _kind, ...legacy } = e; void _kind;
  expect(SimEventSchema.safeParse(legacy).success).toBe(true);
});
