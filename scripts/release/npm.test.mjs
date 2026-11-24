import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { createNpmRegistryAdapter, runNpm } from "./npm.mjs";
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
    "--json",
    "--registry",
    registryUrl,
  ]);
  assert.deepEqual(calls[1], [
    "dist-tag",
    "add",
    `${pkg.name}@${pkg.version}`,
    "next",
    "--json",
    "--registry",
    registryUrl,
  ]);
  assert.deepEqual(calls[2], [
    "dist-tag",
    "rm",
    pkg.name,
    "next",
    "--json",
    "--registry",
    registryUrl,
  ]);
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

await test("npm 12 query arrays contain exactly one version or tag result", async () => {
  let result = {
    code: 0,
    stdout: JSON.stringify([{ latest: "0.5.0", next: pkg.version }]),
    stderr: "",
  };
  const adapter = createNpmRegistryAdapter({ run: async () => result });
  assert.equal(await adapter.getTag(pkg.name, "next"), pkg.version);
  result.stdout = JSON.stringify([pkg.integrity]);
  assert.deepEqual(await adapter.getVersion(pkg.name, pkg.version), { integrity: pkg.integrity });
  for (const value of [
    [],
    [{ next: pkg.version }, { next: "2.0.0-alpha.0" }],
    [[{ next: pkg.version }]],
  ]) {
    result.stdout = JSON.stringify(value);
    await assert.rejects(adapter.getTag(pkg.name, "next"), { code: "REGISTRY_INVALID" });
    await assert.rejects(adapter.getVersion(pkg.name, pkg.version), { code: "REGISTRY_INVALID" });
  }
});

await test("failed npm writes retain the package and safe error code without leaking raw diagnostics", async () => {
  const adapter = createNpmRegistryAdapter({
    authorize: () => undefined,
    run: async () => ({
      code: 1,
      stdout: JSON.stringify({ error: { code: "E422", summary: "Bearer private-secret" } }),
      stderr: "Authorization: Bearer another-secret\nnpm error code E422\n",
    }),
  });
  await assert.rejects(
    adapter.publish(pkg, resolve("retained/identity.tgz"), `candidate-${"a".repeat(64)}`),
    (error) =>
      error instanceof ReleaseError &&
      error.message.includes("E422") &&
      error.message.includes(pkg.name) &&
      !/secret|Bearer|Authorization/.test(error.message),
  );
});

await test("npm provenance uses the verified producer commit across workflow_run handoff", async () => {
  const sourceSha = "1".repeat(40);
  /** @type {NodeJS.ProcessEnv[]} */ const environments = [];
  const registry = createNpmRegistryAdapter({
    sourceSha,
    authorize: () => undefined,
    run: async (_args, env) => {
      environments.push(env);
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  await registry.setTag("@ternent/identity", "1.0.0-alpha.0", "next");
  assert.equal(environments[0].GITHUB_SHA, sourceSha);
  assert.equal(environments[0].NPM_CONFIG_USERCONFIG, "/dev/null");
  assert.equal(environments[0].NPM_CONFIG_IGNORE_SCRIPTS, "true");
  assert.throws(() => createNpmRegistryAdapter({ sourceSha: "main" }));
});

await test("real npm starts with isolated user and global configs", async () => {
  const result = await runNpm(["--version"], {
    PATH: process.env.PATH,
    NPM_CONFIG_USERCONFIG: "/dev/null",
    NPM_CONFIG_GLOBALCONFIG: "/dev/null",
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

await test("an explicitly selected latest adapter cannot read or mutate next", async () => {
  /** @type {string[][]} */ const calls = [];
  const adapter = createNpmRegistryAdapter({
    channel: "latest",
    authorize: () => undefined,
    run: async (args) => {
      calls.push(args);
      return {
        code: 0,
        stdout: JSON.stringify({ latest: "1.0.0", next: "1.1.0-alpha.0" }),
        stderr: "",
      };
    },
  });
  assert.equal(await adapter.getTag(pkg.name, "latest"), "1.0.0");
  await adapter.setTag(pkg.name, "1.0.0", "latest");
  await adapter.removeTag(pkg.name, "latest");
  await assert.rejects(adapter.getTag(pkg.name, "next"), { code: "PLAN_INVALID" });
  await assert.rejects(adapter.setTag(pkg.name, "1.0.0", "next"), { code: "PLAN_INVALID" });
  await assert.rejects(adapter.removeTag(pkg.name, "next"), { code: "PLAN_INVALID" });
  assert(calls.every((args) => !args.includes("next")));
});
