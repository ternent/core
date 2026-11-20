import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const packages = [
  "--filter",
  "@ternent/identity",
  "--filter",
  "@ternent/armour",
  "--filter",
  "@ternent/concord",
  "--filter",
  "@ternent/app-handshake",
  "--filter",
  "./tooling/*",
  "--filter",
  "./fixtures/tooling-profiles/*",
  "--fail-if-no-match",
];
/** @type {Array<[string, string[]]>} */
const gates = [
  ["contract", ["run", "contract"]],
  ["format", ["run", "fmt:check"]],
  ["build", ["exec", "vp", "run", ...packages, "build-ready"]],
  ["lint", ["run", "lint"]],
  ["types:tooling", ["--filter", "@ternent/tooling", "run", "typecheck"]],
  ["types:root", ["run", "typecheck"]],
  [
    "types:fixtures",
    [
      "exec",
      "vp",
      "run",
      "--filter",
      "./fixtures/tooling-profiles/*",
      "--fail-if-no-match",
      "typecheck",
    ],
  ],
  [
    "types:products",
    [
      "exec",
      "vp",
      "run",
      "--filter",
      "@ternent/identity",
      "--filter",
      "@ternent/armour",
      "--filter",
      "@ternent/concord",
      "--filter",
      "@ternent/app-handshake",
      "--fail-if-no-match",
      "typecheck",
    ],
  ],
  ["behavior", ["run", "test"]],
  ["handshake:artifact", ["--filter", "@ternent/app-handshake", "run", "check:artifact"]],
  ["consumers", ["run", "check:artifact"]],
];
/** @type {{gate: string, seconds: number, exitCode: number}[]} */
const report = [];
for (const [gate, args] of gates) {
  const started = performance.now();
  console.log(`\n[tooling-pilot] ${gate}`);
  const result = spawnSync("pnpm", /** @type {string[]} */ (args), {
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
  report.push({
    gate: /** @type {string} */ (gate),
    seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
    exitCode: result.status ?? 1,
  });
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/pilot-check.json",
    `${JSON.stringify({ scope: "alpha-first-slice", node: process.version, gates: report }, null, 2)}\n`,
  );
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
