import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { validateManifest, validatePackage } from "@ternent/tooling/validation";
import { defineLibrary } from "@ternent/tooling/config";

/** @type {string[]} */
const temporary = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function manifest() {
  return {
    name: "@fixture/example",
    version: "1.0.0",
    type: "module",
    private: true,
    ternent: { profile: "ts-library" },
    scripts: Object.fromEntries(
      ["fmt:check", "lint", "typecheck", "test", "build", "check:artifact", "check"].map((name) => [
        name,
        "fixture-command",
      ]),
    ),
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  };
}

/** @param {object} data @param {Record<string, string>} [output] */
function fixture(data, output = {}) {
  const root = mkdtempSync(join(tmpdir(), "ternent-validator-"));
  temporary.push(root);
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "package.json"), JSON.stringify(data));
  for (const [name, text] of Object.entries(output)) writeFileSync(join(root, "dist", name), text);
  return root;
}

test("missing required checks and hidden pack builds are rejected", () => {
  const input = manifest();
  delete input.scripts.test;
  input.scripts.prepack = "build";
  expect(validateManifest(input).map((finding) => finding.code)).toEqual([
    "SCRIPT_MISSING",
    "LIFECYCLE_FORBIDDEN",
  ]);
});

test("a clean source package does not require not-yet-built output", () => {
  expect(validatePackage(fixture(manifest()))).toEqual([]);
});

test("missing runtime and declaration outputs fail artifact checks", () => {
  const root = fixture(manifest());
  expect(validatePackage(root, { built: true }).map((finding) => finding.code)).toEqual([
    "OUTPUT_MISSING",
    "OUTPUT_MISSING",
  ]);
});

test("public declarations cannot hide undeclared dependency imports", () => {
  const root = fixture(manifest(), {
    "index.js": "export const value = 1;",
    "index.d.ts": 'export type { Hidden } from "missing-package";',
  });
  expect(validatePackage(root, { built: true })).toEqual([
    expect.objectContaining({ code: "DEPENDENCY_UNDECLARED" }),
  ]);
});

test("a source alias cannot masquerade as a published dependency", () => {
  const root = fixture(manifest(), {
    "index.js": 'export { value } from "@/source-only";',
    "index.d.ts": "export declare const value: number;",
  });
  expect(validatePackage(root, { built: true })).toEqual([
    expect.objectContaining({ code: "DEPENDENCY_UNDECLARED" }),
  ]);
});

test("neutral libraries cannot accidentally import Node APIs", () => {
  const root = fixture(manifest(), { "index.js": 'import "node:fs";', "index.d.ts": "export {};" });
  expect(validatePackage(root, { built: true })).toEqual([
    expect.objectContaining({ code: "NODE_IMPORT_FORBIDDEN" }),
  ]);
});

test("missing CSS and path traversal are rejected", () => {
  const data = {
    ...manifest(),
    exports: {
      ...manifest().exports,
      "./style.css": "./dist/missing.css",
      "./outside.css": "../outside.css",
    },
  };
  const root = fixture(data, { "index.js": "export {};", "index.d.ts": "export {};" });
  expect(validatePackage(root, { built: true }).map((finding) => finding.code)).toEqual([
    "OUTPUT_MISSING",
    "EXPORT_ESCAPE",
  ]);
});

test("CLI bins need both a shebang and executable mode", () => {
  const data = {
    ...manifest(),
    ternent: { profile: "node-cli" },
    bin: { fixture: "./dist/index.js" },
  };
  const root = fixture(data, { "index.js": "console.log('fixture');", "index.d.ts": "export {};" });
  expect(validatePackage(root, { built: true })).toEqual([
    expect.objectContaining({ code: "BIN_INVALID" }),
  ]);
  writeFileSync(join(root, "dist/index.js"), "#!/usr/bin/env node\nconsole.log('fixture');");
  chmodSync(join(root, "dist/index.js"), 0o755);
  expect(validatePackage(root, { built: true })).toEqual([]);
});

test("unknown profile build options cannot silently pass through", () => {
  // @ts-expect-error The public profile contract is intentionally small.
  expect(() => defineLibrary({ entry: { index: "src/index.ts" }, mystery: true })).toThrow(
    TypeError,
  );
});

test("package versions must be explicit semantic versions", () => {
  expect(validateManifest({ ...manifest(), version: "latest" })).toEqual([
    expect.objectContaining({ code: "VERSION_INVALID" }),
  ]);
});

test("legacy entry fields and wildcard exports cannot hide absent files or traversal", () => {
  const root = fixture({
    ...manifest(),
    main: "./dist/stale.js",
    exports: {
      "./configs/*": "./missing/*",
      "./outside/*": "./../outside/*",
    },
  });
  expect(validatePackage(root, { built: true }).map((finding) => finding.code)).toEqual([
    "OUTPUT_MISSING",
    "EXPORT_ESCAPE",
    "OUTPUT_MISSING",
  ]);
});

test("profile entry maps must contain usable file names", () => {
  expect(() => defineLibrary({ entry: {} })).toThrow(TypeError);
  // @ts-expect-error Runtime callers also receive a useful error.
  expect(() => defineLibrary({ entry: { index: 42 } })).toThrow(TypeError);
});
