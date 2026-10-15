import { expect, it } from "vitest";
import { parseRunArgs, loadScenario, validateScenarioFiles } from "./cli";
import { mockScenario } from "../src/contracts/mocks/ak";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

it("parses deterministic seeds and bounded run options", () => {
  const args = parseRunArgs(["--seeds", "0,42", "--ticks", "30", "--mode", "centralised"]);
  expect(args.seeds).toEqual([0, 42]); expect(args.ticks).toBe(30); expect(args.mode).toBe("centralised");
});
it.each([["--seeds", "-1"], ["--ticks", "0"], ["--mode", "random"], ["--seeds", ""], ["--seeds", "1,"], ["--typo"]])("rejects invalid CLI input %s", (...args) => {
  expect(() => parseRunArgs(args)).toThrow();
});
it("uses a labelled mock when no template is selected", async () => {
  expect((await loadScenario()).name).toContain("MOCK");
});
it("reports missing templates distinctly from validated fixtures", async () => {
  const result = await validateScenarioFiles("nonexistent-contract-test-directory");
  expect(result.templates).toBe(0); expect(result.fixture).toBe(mockScenario().name);
  await expect(validateScenarioFiles("nonexistent-contract-test-directory", true)).rejects.toThrow(/No scenario templates/);
});
it("does not claim release readiness from one schema-valid scenario file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "floodsim-validation-"));
  try {
    await writeFile(join(directory, "fixture.json"), JSON.stringify(mockScenario()));
    const result = await validateScenarioFiles(directory, true);
    expect(result.templates).toBe(1); expect(result.templatesPresent).toBe(true);
    expect(result.validation).toBe("schema-only"); expect(result.releaseReady).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
