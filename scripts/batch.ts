import { runBatch, SIM_CAPABILITIES } from "../src/sim";
import { parseRunArgs, loadScenario, saveOutput } from "./cli";

try {
  const args = parseRunArgs(process.argv.slice(2));
  const scenario = await loadScenario(args.scenario);
  const runs = runBatch(scenario, args.seeds, args.mode, { durationTicks: args.ticks });
  await saveOutput(args.out, { stage: "living-city", capabilities: SIM_CAPABILITIES, scenario: scenario.name, durationTicks: args.ticks, runs });
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
