import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** @typedef {{name: string, path: string}} WorkspacePackage */

/** @param {string} [root] @returns {WorkspacePackage[]} */
export function workspacePackages(root = process.cwd()) {
  const data = /** @type {WorkspacePackage[]} */ (
    JSON.parse(
      execFileSync("pnpm", ["list", "--recursive", "--depth", "-1", "--json"], {
        cwd: root,
        encoding: "utf8",
      }),
    )
  );
  return data.filter((entry) => resolve(entry.path) !== resolve(root));
}

/** @typedef {{
 * name: string, version: string, type: string, private?: boolean,
 * packageManager?: string, exports?: Record<string, unknown>, bin?: Record<string, string>,
 * dependencies?: Record<string, string>, peerDependencies?: Record<string, string>,
 * scripts?: Record<string, string>, publishConfig?: {access?: string}
 * }} PackageManifest */
/** @param {string} root @returns {PackageManifest} */
export function readManifest(root) {
  return JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
}
