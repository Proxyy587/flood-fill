import { parseArgs } from "node:util";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { DispatchModeSchema, RunOptionsSchema, ScenarioSchema, SeedSchema } from "../src/contracts";
import { mockScenario } from "../src/contracts/mocks";

export function parseRunArgs(args: string[]) {
  const { values } = parseArgs({ args, options: { scenario: { type: "string" }, seeds: { type: "string", default: "42,43,44" }, ticks: { type: "string", default: "600" }, mode: { type: "string", default: "negotiation" }, out: { type: "string" } }, strict: true, allowPositionals: false });
  const rawSeeds = values.seeds!.split(",");
  if (rawSeeds.some((s) => !/^\d+$/.test(s))) throw new Error("Seeds must be comma-separated uint32 integers");
  if (!/^\d+$/.test(values.ticks!)) throw new Error("Ticks must be a positive integer");
  const seeds = z.array(SeedSchema).min(1).max(1000).parse(rawSeeds.map(Number));
  const ticks = RunOptionsSchema.parse({ durationTicks: Number(values.ticks) }).durationTicks!;
  return { scenario: values.scenario, seeds, ticks, mode: DispatchModeSchema.parse(values.mode), out: values.out };
}
export async function loadScenario(path?: string) {
  return ScenarioSchema.parse(path === undefined ? mockScenario() : JSON.parse(await readFile(path, "utf8")));
}
export async function saveOutput(path: string | undefined, output: unknown) {
  const json = JSON.stringify(output, null, 2);
  if (path !== undefined) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, json + "\n", "utf8"); }
  else process.stdout.write(json + "\n");
}
export async function validateScenarioFiles(directory = "scenarios", requireTemplates = false) {
  const fixture = ScenarioSchema.parse(mockScenario()).name;
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    names = [];
  }
  const files = names.filter((name) => name.endsWith(".json") && name !== "index.json").sort();
  for (const file of files) await loadScenario(`${directory}/${file}`);
  if (requireTemplates && files.length === 0) throw new Error("No scenario templates found; Worker 1 templates are required for release");
  return { fixture, templates: files.length, files, templatesPresent: files.length > 0, validation: "schema-only", releaseReady: false };
}
