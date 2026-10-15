import { parseArgs } from "node:util";
import { validateScenarioFiles } from "./cli";

try {
  const { values } = parseArgs({ options: { "require-templates": { type: "boolean", default: false } }, strict: true });
  const result = await validateScenarioFiles("scenarios", values["require-templates"]);
  console.log(JSON.stringify(result, null, 2));
  if (!result.templatesPresent) console.warn("Only the MOCK contract fixture was validated. No Worker 1 templates exist yet; this is not a release validation.");
  else console.warn("Schema validation passed. Connectivity, template quality and full release readiness are separate gates.");
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
