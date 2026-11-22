import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

/** @type {Array<[string, string[]]>} */
const gates = [
  ["contract", ["run", "contract"]],
  ["format", ["run", "fmt:check"]],
  ["build", ["run", "build"]],
  ["lint", ["run", "lint"]],
  ["types:root", ["run", "typecheck"]],
  ["types:workspace", ["--recursive", "run", "typecheck"]],
  ["behavior", ["run", "test"]],
  ["release", ["run", "test:release"]],
  ["consumers", ["run", "check:artifact"]],
];
/** @type {{gate: string, seconds: number, exitCode: number}[]} */
const report = [];
const sourceSha =
  process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
for (const [gate, args] of gates) {
  const started = performance.now();
  console.log(`\n[verify] ${gate}`);
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
    "artifacts/check.json",
    `${JSON.stringify({ scope: "active-workspace", sourceSha, node: process.version, gates: report }, null, 2)}\n`,
  );
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
