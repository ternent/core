import { readFileSync } from "node:fs";
import { validatePackage } from "@ternent/tooling/validation";
import { readManifest, workspacePackages } from "./workspace.mjs";

const expectedNode = readFileSync(".node-version", "utf8").trim();
if (process.versions.node !== expectedNode)
  throw new Error(`TOOLCHAIN_MISMATCH: use Node ${expectedNode}`);
const root = readManifest(process.cwd());
if (!root.private) throw new Error("CONTRACT_INVALID: workspace root must stay private");
const actualPnpm = process.env.npm_config_user_agent?.split(" ")[0];
const expectedPnpm = root.packageManager?.replace("@", "/");
if (!actualPnpm || actualPnpm !== expectedPnpm)
  throw new Error(`TOOLCHAIN_MISMATCH: use ${root.packageManager}`);
if (readFileSync(".nvmrc", "utf8").trim() !== expectedNode)
  throw new Error("TOOLCHAIN_MISMATCH: Node version files disagree");
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
      scope: "active-workspace",
      packages: [...names],
      excluded: ["packages/workspace", "packages/ui", "scripts/vite"],
      findings,
    },
    null,
    2,
  ),
);
if (findings.length) process.exitCode = 1;
