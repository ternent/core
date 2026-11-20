import { readFileSync } from "node:fs";
import { validatePackage } from "@ternent/tooling/validation";
import { readManifest, workspacePackages } from "./workspace.mjs";

const expectedNode = readFileSync(".node-version", "utf8").trim();
if (process.versions.node !== expectedNode)
  throw new Error(`TOOLCHAIN_MISMATCH: use Node ${expectedNode}`);
const root = readManifest(process.cwd());
if (!root.private) throw new Error("CONTRACT_INVALID: workspace root must stay private");
if (root.packageManager !== "pnpm@10.33.4")
  throw new Error("TOOLCHAIN_MISMATCH: use pinned pnpm 10.33.4");
const packages = workspacePackages();
const names = new Set(packages.map((entry) => entry.name));
if (names.size !== packages.length || packages.length === 0)
  throw new Error("CONTRACT_INVALID: empty or duplicate workspace");
/** @type {import('@ternent/tooling/validation').Finding[]} */
const findings = [];
for (const entry of packages) {
  findings.push(
    ...validatePackage(entry.path).map((finding) => ({
      ...finding,
      path: `${entry.name}${finding.path}`,
    })),
  );
  const manifest = readManifest(entry.path);
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (names.has(name) && !range.startsWith("workspace:"))
      findings.push({ code: "WORKSPACE_RANGE_REQUIRED", path: entry.name, message: name });
  }
}
console.log(
  JSON.stringify(
    {
      scope: "alpha-first-slice",
      packages: [...names],
      legacyExcluded: [
        "packages/ledger",
        "packages/workspace",
        "packages/seal",
        "packages/ui",
        "packages/utils",
        "packages/*/legacy",
        "scripts/vite",
        ".ops",
      ],
      findings,
    },
    null,
    2,
  ),
);
if (findings.length) process.exitCode = 1;
