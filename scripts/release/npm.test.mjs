import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { createNpmRegistryAdapter } from "./npm.mjs";
import { registryUrl, ReleaseError } from "./shared.mjs";

const pkg = {
  name: "@ternent/identity",
  version: "1.0.0-alpha.0",
  tarball: "candidates/identity.tgz",
  sha256: "a".repeat(64),
  integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
  dependencies: [],
};

await test("npm adapter uses exact retained tarball argv, fixed registry and explicit channel only", async () => {
  /** @type {string[][]} */ const calls = [];
  let authorization = 0;
  const adapter = createNpmRegistryAdapter({
    authorize: () => {
      authorization++;
    },
    run: async (args) => {
      calls.push(args);
      return { code: 0, stdout: "{}", stderr: "" };
    },
  });
  const file = resolve("retained/identity.tgz"),
    tag = `candidate-${"a".repeat(64)}`;
  await adapter.publish(pkg, file, tag);
  await adapter.setTag(pkg.name, pkg.version, "next");
  await adapter.removeTag(pkg.name, "next");
  assert.deepEqual(calls[0], [
    "publish",
    file,
    "--access",
    "public",
    "--tag",
    tag,
    "--ignore-scripts",
    "--provenance",
    "--registry",
    registryUrl,
  ]);
  assert.deepEqual(calls[1], [
    "dist-tag",
    "add",
    `${pkg.name}@${pkg.version}`,
    "next",
    "--registry",
    registryUrl,
  ]);
  assert.deepEqual(calls[2], ["dist-tag", "rm", pkg.name, "next", "--registry", registryUrl]);
  assert.equal(authorization, 3);
  assert(
    calls.every(
      (args) =>
        !args.includes("latest") &&
        !args.includes("pack") &&
        !args.some((arg) => arg.includes("npm publish")),
    ),
  );
});

await test("adapter defaults deny mutations and cannot select latest, arbitrary names or nonretained input", async () => {
  const calls = [];
  const adapter = createNpmRegistryAdapter({
    run: async (args) => {
      calls.push(args);
      return { code: 0, stdout: "{}", stderr: "" };
    },
  });
  await assert.rejects(
    adapter.publish(pkg, resolve("candidate.tgz"), `candidate-${"a".repeat(64)}`),
    { code: "RELEASE_NOT_ENABLED" },
  );
  await assert.rejects(adapter.setTag(pkg.name, pkg.version, "latest"), { code: "PLAN_INVALID" });
  await assert.rejects(adapter.getVersion("evil; command", "1.0.0"), { code: "PLAN_INVALID" });
  await assert.rejects(adapter.publish(pkg, "package-directory", `candidate-${"a".repeat(64)}`), {
    code: "PLAN_INVALID",
  });
  assert.equal(calls.length, 0);
});

await test("saved registry responses distinguish absence, unusable metadata and network errors", async () => {
  let result = { code: 1, stdout: JSON.stringify({ error: { code: "E404" } }), stderr: "" };
  const adapter = createNpmRegistryAdapter({ run: async () => result });
  assert.equal(await adapter.getVersion(pkg.name, pkg.version), null);
  assert.equal(await adapter.getTag(pkg.name, "next"), null);
  result = { code: 0, stdout: JSON.stringify(pkg.integrity), stderr: "" };
  assert.deepEqual(await adapter.getVersion(pkg.name, pkg.version), { integrity: pkg.integrity });
  result = { code: 0, stdout: JSON.stringify({ latest: "0.9.0", next: pkg.version }), stderr: "" };
  assert.equal(await adapter.getTag(pkg.name, "next"), pkg.version);
  result = { code: 0, stdout: JSON.stringify("sha1-unsupported"), stderr: "" };
  await assert.rejects(adapter.getVersion(pkg.name, pkg.version), { code: "REGISTRY_INVALID" });
  result = {
    code: 1,
    stdout: JSON.stringify({ error: { code: "E403" } }),
    stderr: "credential should not escape",
  };
  await assert.rejects(
    adapter.getVersion(pkg.name, pkg.version),
    (error) =>
      error instanceof ReleaseError &&
      error.code === "REGISTRY_UNAVAILABLE" &&
      !error.message.includes("credential"),
  );
});
