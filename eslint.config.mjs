import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { isBuiltin } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("./", import.meta.url));
const sourceRoot = resolve(repositoryRoot, "src");
const impurePackages = new Set(["react", "react-dom", "next", "three", "vitest"]);
const simFiles = ["src/sim/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];
const testFiles = ["**/*.test.{js,jsx,mjs,cjs,ts,tsx,mts,cts}", "**/*.spec.{js,jsx,mjs,cjs,ts,tsx,mts,cts}", "**/__tests__/**"];
const clockGlobal = { name: "Date", message: "Use sim ticks instead of wall-clock time." };

// Only inspect direct dependencies. This is a lint boundary, not a module-graph
// audit: contracts and third-party modules still need to be reviewed for purity.
/** @type {import("eslint").Rule.RuleModule} */
const importBoundary = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      impure: "Sim imports must be environment-independent; '{{source}}' is forbidden.",
      boundary: "Local sim imports must stay in src/sim or src/contracts; '{{source}}' crosses that boundary.",
    },
  },
  create(context) {
    function check(node, source) {
      if (typeof source !== "string") return;
      if (
        source.startsWith("node:") || isBuiltin(source) ||
        impurePackages.has(source.split("/")[0]) ||
        /^[a-z][a-z\d+.-]*:/i.test(source) && !isAbsolute(source)
      ) {
        context.report({ node, messageId: "impure", data: { source } });
        return;
      }

      let target;
      if (source.startsWith(".")) target = resolve(dirname(context.filename), source);
      else if (source.startsWith("@/")) target = resolve(repositoryRoot, source.slice(2));
      else if (isAbsolute(source)) target = resolve(source);
      else return;

      // Normalize '..' before checking the directory, including the repo's @/* alias.
      const [directory] = relative(sourceRoot, target).split(sep);
      if (directory !== "sim" && directory !== "contracts") {
        context.report({ node, messageId: "boundary", data: { source } });
      }
    }

    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => check(node, node.source?.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      TSImportType: (node) => check(node, node.source.value),
      TSExternalModuleReference: (node) => check(node, node.expression.value),
    };
  },
};

/** @type {import("eslint").Rule.RuleModule} */
const deterministicMath = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      random: "Use the seeded sim RNG instead of Math.random.",
      escape: "Access deterministic Math members directly with a static key; do not alias, destructure or dynamically index Math.",
    },
  },
  create(context) {
    return {
      "Program:exit"(node) {
        const scope = context.sourceCode.getScope(node);
        // Resolve ambient references so local parameters named Math remain valid.
        const references = [
          ...scope.through,
          ...scope.variables.filter((variable) => variable.defs.length === 0)
            .flatMap((variable) => variable.references),
        ];
        for (const reference of references) {
          if (reference.identifier.name !== "Math" || reference.isValueReference === false) continue;
          const identifier = reference.identifier;
          const member = identifier.parent;
          let key;
          if (member.type === "MemberExpression" && member.object === identifier) {
            if (!member.computed) key = member.property.name;
            else if (member.property.type === "Literal") key = member.property.value;
            else if (member.property.type === "TemplateLiteral" && member.property.expressions.length === 0) {
              key = member.property.quasis[0].value.cooked;
            }
          }
          if (typeof key !== "string" || key === "random") {
            context.report({ node: identifier, messageId: key === "random" ? "random" : "escape" });
          }
        }
      },
    };
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/render/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["**/sim/**", "**/contracts/mocks/**"] }],
    },
  },
  {
    name: "sim/determinism",
    files: simFiles,
    plugins: { sim: { rules: { "import-boundary": importBoundary, "deterministic-math": deterministicMath } } },
    rules: {
      "sim/deterministic-math": "error",
      "no-restricted-globals": ["error", { globals: [clockGlobal], checkGlobalObject: true, globalObjects: ["global"] }],
    },
  },
  {
    name: "sim/purity",
    files: simFiles,
    // Tests may import Vitest/Node and use host APIs. Determinism still applies.
    ignores: testFiles,
    rules: {
      "sim/import-boundary": "error",
      "no-restricted-globals": ["error", {
        globals: [
          clockGlobal,
          ...[
            "window", "document", "self", "postMessage", "navigator", "fetch", "crypto",
            "setTimeout", "setInterval", "clearTimeout", "clearInterval", "performance", "process",
            "globalThis", "global", "eval", "Function", "require", "module", "exports",
            "Buffer", "__dirname", "__filename", "setImmediate", "clearImmediate",
            "Worker", "SharedWorker", "XMLHttpRequest", "WebSocket", "EventSource",
            "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask",
            "localStorage", "sessionStorage", "indexedDB", "location",
          ].map((name) => ({ name, message: "Keep the sim pure; pass data through contracts instead of using host APIs." })),
        ],
        checkGlobalObject: true,
        globalObjects: ["global"],
      }],
      "no-restricted-syntax": ["error",
        { selector: "ImportExpression", message: "Dynamic imports escape the static sim boundary; use a pure static import." },
        { selector: "TSExternalModuleReference", message: "require-style imports are forbidden in the sim; use a pure static import." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "vendor/laya-ts/**",
  ]),
]);

export default eslintConfig;
