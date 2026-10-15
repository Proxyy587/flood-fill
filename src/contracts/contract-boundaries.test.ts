import { expect, it } from "vitest";
import { ScenarioSchema as MainScenarioSchema } from "./schemas";
import { ScenarioSchema as AkScenarioSchema } from "./sim-schemas";
import { mockScenario as mockAkScenario } from "./mocks/ak";
import { mockScenario as mockMainScenario } from "./mocks/scenario";

it("keeps the AK simulator contract and main UI contract independently valid", () => {
  expect(AkScenarioSchema.safeParse(mockAkScenario()).success).toBe(true);
  expect(MainScenarioSchema.safeParse(mockMainScenario()).success).toBe(true);
});
