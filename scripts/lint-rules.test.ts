import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cwd = fileURLToPath(new URL("../", import.meta.url));
// Load the repository config, including Next's parser and the actual file globs.
const eslint = new ESLint({ cwd, overrideConfigFile: "eslint.config.mjs" });

async function lint(code: string, filePath = "src/sim/lint-probe.ts") {
  const [result] = await eslint.lintText(code, { filePath });
  expect(result.fatalErrorCount, JSON.stringify(result.messages)).toBe(0);
  expect(result.messages.some((message) => message.ruleId === null)).toBe(false);
  return result;
}

async function rejects(code: string, filePath?: string) {
  const result = await lint(code, filePath);
  // An unrelated TypeScript/Next warning must not make a guard test pass.
  const guardErrors = result.messages.filter(
    (message) =>
      message.severity === 2 &&
      (message.ruleId?.startsWith("sim/") ||
        message.ruleId === "no-restricted-imports" ||
        message.ruleId === "no-restricted-globals" ||
        message.ruleId === "no-restricted-syntax"),
  );
  expect(guardErrors, JSON.stringify(result.messages)).not.toHaveLength(0);
}

describe("sim import purity using the repository ESLint config", () => {
  it.each([
    "react", "react/jsx-runtime", "react-dom", "react-dom/client",
    "next", "next/navigation", "three", "three/addons/loaders/GLTFLoader.js",
    "node:fs", "node:fs/promises", "node:test", "node:sqlite",
    "fs", "fs/promises", "path", "stream", "stream/web", "util/types",
    "worker_threads", "child_process", "crypto", "timers/promises", "module",
  ])("rejects imports and reexports from %s", async (source) => {
    await rejects(`import ${JSON.stringify(source)};`);
    await rejects(`export * from ${JSON.stringify(source)};`);
    await rejects(`export { forbidden } from ${JSON.stringify(source)};`);
    await rejects(`import type { Forbidden } from ${JSON.stringify(source)}; export type { Forbidden };`);
  });

  it.each([
    "../ui/panel", "../render/scene", "../assets/palette", "../editor/tools",
    "../ai/critic", "../../app/api/critic/route", "@/src/ui/panel",
    "@/src/render/scene", "@/src/assets/palette", "@/app/page",
    "./world/../../ui/panel", "../contracts/../render/scene", "../simulation/helper",
    "file:///tmp/helper.ts", "data:text/javascript,export default 1",
  ])("rejects local boundary escapes and URL modules: %s", async (source) => {
    await rejects(`import ${JSON.stringify(source)};`);
    await rejects(`export * from ${JSON.stringify(source)};`);
  });

  it("checks nested relative paths from the linted file, not cwd", async () => {
    await rejects('export * from "../../assets/palette";', "src/sim/nav/probe.ts");
    const result = await lint('export * from "../../contracts/types";', "src/sim/nav/probe.ts");
    expect(result.messages).toEqual([]);
  });

  it.each([
    'export type Escape = import("node:fs").Stats;',
    'export type Escape = import("../render/scene").Scene;',
    'import fs = require("node:fs"); export { fs };',
  ])("rejects TypeScript module escapes: %s", rejects);
});

describe("sim runtime purity", () => {
  it.each([
    "window", "document", "self", "postMessage", "navigator", "fetch", "crypto",
    "setTimeout", "setInterval", "performance", "process", "globalThis", "global",
    "Worker", "XMLHttpRequest", "Buffer", "setImmediate", "requestAnimationFrame",
  ])("rejects access to %s, including capturing it for later", async (name) => {
    await rejects(`export const escape = ${name};`);
  });

  it.each([
    'eval("1 + 1");', 'export const execute = eval;',
    'export const execute = Function("return 1");',
    'export const execute = new Function("return 1");',
    'require("fs");', 'export const load = require;',
    'export const load = () => import("./rng");',
    'export const load = (name: string) => import(name);',
    'globalThis["fetch"]("/");', 'globalThis.Math["random"]();',
    'const { fetch: request } = globalThis; export { request };',
  ])("rejects runtime escapes: %s", async (code) => { await rejects(code); });
});

describe("sim determinism", () => {
  it.each([
    "Math.random();", "Math['random']();", "Math[`random`]();", "Math.random?.();",
    "export const random = Math.random;", "export const math = Math;",
    "const { random } = Math; export { random };",
    'export const sample = (key: keyof Math) => Math[key];',
    "Date.now();", "Date['now']();", "Date();", "new Date();", "new Date(0);",
    "export const Clock = Date;", "const { now } = Date; export { now };",
  ])("rejects nondeterministic access: %s", async (code) => { await rejects(code); });

  it("accepts seeded RNG, deterministic math, sim modules and contracts", async () => {
    const result = await lint(`
      import { createRng } from "./rng";
      import type { Scenario } from "../contracts/types";
      export { ScenarioSchema } from "@/src/contracts/schemas";
      export type ScenarioType = import("../contracts/types").Scenario;
      export const sample = (scenario: Scenario) => {
        const rng = createRng(scenario.seed);
        return Math.floor(rng.next() * 10) + Math['abs'](-1) + Math.imul(2, 3) + Math.PI;
      };
    `);
    expect(result.messages).toEqual([]);
  });

  it("does not confuse local names or object properties with ambient APIs", async () => {
    const result = await lint(`
      export function local(fetch: () => number, Date: () => number, Math: { random: () => number }) {
        const state = { window: 1, document: 2, random: 3 };
        return fetch() + Date() + Math.random() + state.window + state.document + state.random;
      }
    `);
    expect(result.messages).toEqual([]);
  });
});

describe("guard file scope", () => {
  it.each(["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"])("guards supported simulation extension .%s", async (extension) => {
    await rejects("const x = Math.random() + Date.now(); void x;", `src/sim/probe.${extension}`);
    await rejects("const x = window; void x;", `src/sim/probe.${extension}`);
  });
  it.each(["src/sim/rng.test.ts", "src/sim/nav/route.test.ts", "src/sim/route.spec.ts", "src/sim/__tests__/fixture.ts"])(
    "allows Vitest and Node in %s", async (filePath) => {
      const result = await lint(`
        import { expect, it } from "vitest";
        import { readFileSync } from "node:fs";
        it("fixture", () => { expect(typeof readFileSync).toBe("function"); });
      `, filePath);
      expect(result.messages).toEqual([]);
    },
  );

  it("keeps determinism checks active in sim tests", async () => {
    await rejects("Math['random']();", "src/sim/rng.test.ts");
    await rejects("Date['now']();", "src/sim/rng.test.ts");
  });

  it("does not apply sim restrictions to UI and tooling", async () => {
    for (const filePath of ["src/ui/probe.ts", "scripts/probe.ts"]) {
      const result = await lint('import "node:fs"; fetch("/"); Math.random(); Date.now();', filePath);
      expect(result.messages).toEqual([]);
    }
  });
});
