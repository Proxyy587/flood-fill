import { runBatch, SIM_CAPABILITIES } from "../src/sim";
import { parseRunArgs, loadScenario, saveOutput } from "./cli";

try {
  const args = parseRunArgs(process.argv.slice(2));
  const scenario = await loadScenario(args.scenario);
  const centralised = runBatch(scenario, args.seeds, "centralised", { durationTicks: args.ticks });
  const negotiation = runBatch(scenario, args.seeds, "negotiation", { durationTicks: args.ticks });
  await saveOutput(args.out, {
    stage: "living-city", capabilities: SIM_CAPABILITIES,
    conclusion: "Both deterministic dispatch policies run on identical seeds. Compare observed metrics; no policy is assumed to be universally superior.",
    seeds: args.seeds, durationTicks: args.ticks, centralised, negotiation,
  });
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
