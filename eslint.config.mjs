import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const PURE_IMPORTS = {
  paths: ["react", "react-dom", "next", "three", "zustand"],
  patterns: ["react/*", "react-dom/*", "next/*", "three/*", "**/render/**", "**/ui/**", "**/editor/**", "**/bridge/**"],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "import/no-default-export": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // AGENTS.md rules 1 + 2: the sim (and the contracts/mocks it shares) is pure and deterministic.
    files: ["src/sim/**/*.ts", "src/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", PURE_IMPORTS],
      "no-restricted-globals": [
        "error",
        { name: "window", message: "src/sim must run in Node." },
        { name: "document", message: "src/sim must run in Node." },
        { name: "performance", message: "Wall-clock time breaks determinism; use the tick." },
        { name: "localStorage", message: "src/sim must run in Node." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded ctx.rng (src/sim/rng.ts)." },
        { object: "Date", property: "now", message: "Wall-clock time breaks determinism; use the tick." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date']", message: "Wall-clock time breaks determinism; use the tick." },
      ],
    },
  },
  {
    // AGENTS.md rule 3: the renderer reads RenderSnapshots; it never reaches into the sim.
    files: ["src/render/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["**/sim/**", "**/contracts/mocks/**"] }],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
