import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createIdentity } from "@ternent/identity";
import { runCli } from "../src/cli.js";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "seal-cli-"));
  const identity = await createIdentity();
  const identityFile = join(dir, "identity.json");
  await writeFile(identityFile, identity.export());
  const input = join(dir, "release-manifest.json");
  await writeFile(input, '{"release":"1.0.0"}\n');
  return { dir, identity, input, env: { SEAL_IDENTITY_FILE: identityFile } };
}

function io(env: Record<string, string | undefined> = {}) {
  const out = { stdout: "", stderr: "" };
  return {
    out,
    io: {
      env,
      stdout: (text: string) => void (out.stdout += text),
      stderr: (text: string) => void (out.stderr += text),
    },
  };
}

test("sign writes a proof that verify accepts", async () => {
  const { dir, identity, input, env } = await setup();
  const proofPath = join(dir, "proof.json");
  expect(await runCli(["sign", "--input", input, "--out", proofPath], io(env).io)).toBe(0);
  expect(JSON.parse(await readFile(proofPath, "utf8")).signer).toEqual(identity.publicIdentity);

  const verified = io();
  expect(await runCli(["verify", "--proof", proofPath, "--input", input], verified.io)).toBe(0);
  expect(JSON.parse(verified.out.stdout)).toEqual({
    valid: true,
    signatureValid: true,
    hashMatch: true,
  });
});

test("sign without --out prints the proof", async () => {
  const { input, env } = await setup();
  const signed = io(env);
  expect(await runCli(["sign", "--input", input], signed.io)).toBe(0);
  expect(JSON.parse(signed.out.stdout).format).toBe("seal");
});

test("verify exits 2 when the input changed", async () => {
  const { dir, input, env } = await setup();
  const proofPath = join(dir, "proof.json");
  await runCli(["sign", "--input", input, "--out", proofPath], io(env).io);
  await writeFile(input, '{"release":"1.0.1"}\n');
  const verified = io();
  expect(await runCli(["verify", "--proof", proofPath, "--input", input], verified.io)).toBe(2);
  expect(JSON.parse(verified.out.stdout)).toMatchObject({ valid: false, hashMatch: false });
});

test("usage errors, missing identity and unreadable files exit 1", async () => {
  const { dir, input, env } = await setup();
  const badIdentity = join(dir, "bad.json");
  await writeFile(badIdentity, "{}");
  const cases: [string[], Record<string, string>][] = [
    [["sign", "--input", input], {}],
    [["sign", "--input", input], { SEAL_IDENTITY_FILE: badIdentity }],
    [["sign"], env],
    [["verify", "--input", input], env],
    [["verify", "--proof", join(dir, "missing.json"), "--input", input], env],
    [["publish", "--input", input], env],
    [["sign", "--input", input, "--unknown"], env],
  ];
  for (const [argv, caseEnv] of cases) {
    const run = io(caseEnv);
    expect(await runCli(argv, run.io)).toBe(1);
    expect(run.out.stderr).not.toBe("");
  }
});

test("help prints usage", async () => {
  const run = io();
  expect(await runCli(["--help"], run.io)).toBe(0);
  expect(run.out.stdout).toMatch(/^Usage: seal sign/);
});
