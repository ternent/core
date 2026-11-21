import { globSync, lstatSync, readFileSync, realpathSync, readdirSync, existsSync } from "node:fs";
import { isBuiltin } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";

const profiles = new Set([
  "ts-library",
  "node-cli",
  "vue-library",
  "vue-app",
  "docs-app",
  "tooling",
]);
const requiredScripts = [
  "fmt:check",
  "lint",
  "typecheck",
  "test",
  "build",
  "check:artifact",
  "check",
];

/** @typedef {import('../types/validation.js').Finding} Finding */
/** @typedef {import('../types/validation.js').PackageManifest} PackageManifest */

/** @param {unknown} input @returns {input is Record<string, any>} */
function record(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

/** @param {string} root @param {string} target @returns {string | null} */
function inside(root, target) {
  if (!target.startsWith("./")) return null;
  const file = resolve(root, target);
  const path = relative(root, file);
  return path === "" || path.startsWith(`..${sep}`) || path === ".." || isAbsolute(path)
    ? null
    : file;
}

/** @param {unknown} manifest @returns {Finding[]} */
export function validateManifest(manifest) {
  /** @type {Finding[]} */
  const findings = [];
  /** @param {string} code @param {string} path @param {string} message */
  const fail = (code, path, message) => findings.push({ code, path, message });
  if (!record(manifest))
    return [{ code: "MANIFEST_INVALID", path: "/", message: "Expected an object" }];
  if (typeof manifest.name !== "string" || !/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(manifest.name)) {
    fail("NAME_INVALID", "/name", "Expected a scoped npm package name");
  }
  if (
    typeof manifest.version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/.test(
      manifest.version,
    )
  ) {
    fail("VERSION_INVALID", "/version", "Expected an explicit semantic version");
  }
  if (manifest.type !== "module") fail("MODULE_INVALID", "/type", "The target uses explicit ESM");
  if (!record(manifest.ternent) || !profiles.has(manifest.ternent.profile)) {
    fail("PROFILE_INVALID", "/ternent/profile", "Declare a supported profile");
  }
  for (const name of requiredScripts) {
    if (!record(manifest.scripts) || typeof manifest.scripts[name] !== "string") {
      fail("SCRIPT_MISSING", `/scripts/${name}`, `Missing required ${name} command`);
    }
  }
  for (const name of [
    "prepare",
    "prepack",
    "postpack",
    "prepublish",
    "prepublishOnly",
    "publish",
    "postpublish",
  ]) {
    if (manifest.scripts?.[name])
      fail("LIFECYCLE_FORBIDDEN", `/scripts/${name}`, "Build and pack are explicit gates");
  }
  if (!manifest.private && manifest.publishConfig?.access !== "public") {
    fail("ACCESS_INVALID", "/publishConfig/access", "Public products declare public npm access");
  }
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (typeof range !== "string" || /^(file:|link:)/.test(range)) {
      fail(
        "DEPENDENCY_INVALID",
        `/dependencies/${name}`,
        "Runtime dependencies must resolve after packing",
      );
    }
  }
  return findings;
}

/** @param {string} dir @returns {string[]} */
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? files(file) : [file];
  });
}

/** @param {unknown} value @returns {string[]} */
function targets(value) {
  if (typeof value === "string") return [value];
  if (!record(value)) return [];
  return Object.values(value).flatMap(targets);
}

/** @param {string} source @param {string} file @returns {string[]} */
function imports(source, file) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  /** @type {string[]} */
  const result = [];
  /** @param {import('typescript').Node} node */
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      result.push(node.arguments[0].text);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      result.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return result;
}

/** @param {string} root @param {{built?: boolean}} [options] @returns {Finding[]} */
export function validatePackage(root, { built = false } = {}) {
  const manifest = /** @type {PackageManifest} */ (
    JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
  );
  const findings = validateManifest(manifest);
  const mapping = manifest.exports ?? {};
  for (const [key, value] of Object.entries(mapping)) {
    if (typeof value === "string" && /\.(?:js|mjs)$/.test(value)) {
      findings.push({
        code: "DECLARATION_MISSING",
        path: `/exports/${key}`,
        message: "JavaScript exports require a types condition",
      });
    }
    if (record(value) && (value.import || value.default) && !value.types) {
      findings.push({
        code: "DECLARATION_MISSING",
        path: `/exports/${key}`,
        message: "JavaScript exports require a types condition",
      });
    }
  }
  const publicTargets = [
    ...targets(mapping),
    ...Object.values(manifest.bin ?? {}),
    ...[manifest.main, manifest.module, manifest.types].filter(
      (value) => typeof value === "string",
    ),
  ];
  for (const target of publicTargets) {
    const file = inside(root, target);
    if (!file) {
      findings.push({
        code: "EXPORT_ESCAPE",
        path: target,
        message: "Export/bin must stay within its package",
      });
    } else if (built) {
      const matches = target.includes("*")
        ? globSync(target, { cwd: root }).map((match) => resolve(root, match))
        : [file];
      if (
        matches.length === 0 ||
        matches.some(
          (match) =>
            !existsSync(match) ||
            !lstatSync(match).isFile() ||
            !inside(realpathSync(root), `./${relative(realpathSync(root), realpathSync(match))}`),
        )
      ) {
        findings.push({
          code: "OUTPUT_MISSING",
          path: target,
          message: "Declared artifact target is absent or escapes its package",
        });
      }
    }
  }
  if (!built) return findings;
  for (const target of Object.values(manifest.bin ?? {})) {
    const file = inside(root, target);
    if (!file || !existsSync(file)) continue;
    if (
      !readFileSync(file, "utf8").startsWith("#!/usr/bin/env node\n") ||
      !(lstatSync(file).mode & 0o111)
    ) {
      findings.push({
        code: "BIN_INVALID",
        path: target,
        message: "A bin requires the Node shebang and executable mode",
      });
    }
  }
  const profile = manifest.ternent?.profile;
  if (profile === "vue-app" || profile === "docs-app") {
    const output = profile === "docs-app" ? "site/.vitepress/dist" : "dist";
    if (!existsSync(resolve(root, output, "index.html")))
      findings.push({
        code: "APP_OUTPUT_MISSING",
        path: output,
        message: "Static app entry is absent",
      });
    return findings;
  }
  const outputRoot = resolve(root, profile === "tooling" ? "src" : "dist");
  const scanned = existsSync(outputRoot) ? files(outputRoot) : [];
  if (profile === "tooling")
    scanned.push(...files(resolve(root, "types")), ...files(resolve(root, "bin")));
  const declared = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  for (const file of scanned.filter((path) => /\.(?:[mc]?js|[mc]?ts)$/.test(path))) {
    for (const specifier of imports(readFileSync(file, "utf8"), file)) {
      if (specifier.startsWith(".") || specifier.startsWith("#")) continue;
      if (isBuiltin(specifier)) {
        if (profile === "ts-library" || profile === "vue-library")
          findings.push({
            code: "NODE_IMPORT_FORBIDDEN",
            path: relative(root, file),
            message: `Neutral export imports ${specifier}`,
          });
        continue;
      }
      const dependency = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (!declared.has(dependency))
        findings.push({
          code: "DEPENDENCY_UNDECLARED",
          path: relative(root, file),
          message: `Undeclared public dependency ${dependency}`,
        });
    }
  }
  return findings;
}
