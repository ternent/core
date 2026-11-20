import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function run(cwd, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, timeout: 20_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

function successfulResult(result) {
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stderr.toString(), "");
  return result.stdout;
}

function expectFailure(result, code) {
  assert.equal(result.status, 1, result.stderr.toString());
  assert.equal(result.stdout.length, 0);
  assert.match(result.stderr.toString(), new RegExp(`^${code}:`));
}

async function withAgent(cwd, directory, role, useClient) {
  const client = new Client({ name: `handshake-smoke-${role}`, version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp", directory, role],
    cwd,
  });
  try {
    await client.connect(transport);
    return await useClient(client);
  } finally {
    await client.close();
  }
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  assert.ok(result.structuredContent, `Expected structured ${name} output`);
  return result.structuredContent;
}

async function expectToolFailure(client, name, args, code) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), new RegExp(code));
}

test(
  "the built CLI publishes an MCP agreement, verifies it offline, and gates artifact release",
  { timeout: 60_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "ternent-handshake-smoke-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "handoff");
    const fork = join(root, "fork");
    const artifactPath = join(root, "artifact.bin");
    const reviewerKey = join(directory, "reviewer.key");
    const proposalPath = join(directory, "proposal.json");
    const receiptPath = join(directory, "receipt.json");
    const artifact = Buffer.from([0x74, 0x65, 0x72, 0x6e, 0x65, 0x6e, 0x74, 0x00, 0xff]);
    const digest = createHash("sha256").update(artifact).digest("hex");
    await writeFile(artifactPath, artifact);
    const setup = JSON.parse(successfulResult(run(root, "init", directory, artifactPath)));
    assert.equal(setup.artifactSha256, digest);

    const proposal = await withAgent(root, directory, "sender", async (client) => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map(({ name }) => name).sort(), [
        "handshake_propose",
        "handshake_status",
      ]);
      const initial = await call(client, "handshake_status");
      assert.equal(initial.head, setup.setupHead);
      assert.equal(initial.proposal, null);
      assert.equal(initial.accepted, false);
      const proposed = await call(client, "handshake_propose");
      const published = await readFile(proposalPath);
      await expectToolFailure(client, "handshake_propose", {}, "SNAPSHOT_EXISTS");
      assert.deepEqual(await readFile(proposalPath), published);
      assert.equal((await call(client, "handshake_status")).head, proposed.head);
      return proposed;
    });
    assert.equal(proposal.proposal.artifactSha256, digest);
    assert.notEqual(proposal.proposal.senderId, proposal.proposal.recipientId);
    assert.equal(proposal.accepted, false);
    await cp(directory, fork, { recursive: true });

    const terms = { recipientId: proposal.proposal.recipientId, artifactSha256: digest };
    const accepted = await withAgent(root, directory, "recipient", async (client) => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map(({ name }) => name).sort(), [
        "handshake_accept",
        "handshake_status",
      ]);
      const status = await call(client, "handshake_status");
      assert.equal(status.head, proposal.head);
      assert.deepEqual(status.proposal, proposal.proposal);
      await expectToolFailure(
        client,
        "handshake_accept",
        { ...terms, artifactSha256: "0".repeat(64) },
        "TERMS_MISMATCH",
      );
      await assert.rejects(access(receiptPath), { code: "ENOENT" });
      assert.equal((await call(client, "handshake_status")).head, proposal.head);
      const result = await call(client, "handshake_accept", terms);
      const published = await readFile(receiptPath);
      await expectToolFailure(client, "handshake_accept", terms, "SNAPSHOT_EXISTS");
      assert.deepEqual(await readFile(receiptPath), published);
      assert.equal((await call(client, "handshake_status")).head, result.head);
      return result;
    });
    assert.equal(accepted.accepted, true);
    assert.deepEqual(accepted.proposal, proposal.proposal);

    const receiptBytes = await readFile(receiptPath);
    const rememberedPath = join(root, "remembered.json");
    await writeFile(rememberedPath, receiptBytes);
    const verify = () =>
      successfulResult(run(root, "verify", rememberedPath, reviewerKey, proposalPath));
    const firstReport = verify();
    assert.deepEqual(verify(), firstReport);
    const report = JSON.parse(firstReport);
    assert.equal(report.head, accepted.head);
    assert.equal(report.freshness, "ahead");
    assert.equal(report.accepted, true);
    assert.deepEqual(report.proposal, proposal.proposal);
    assert.equal(receiptBytes.includes(digest), false);

    const uninvitedKey = join(root, "uninvited.key");
    await writeFile(uninvitedKey, Buffer.alloc(32, 0xd1), { mode: 0o600 });
    expectFailure(run(root, "verify", receiptPath, uninvitedKey), "READ_ACCESS_REQUIRED");

    assert.deepEqual(successfulResult(run(root, "release", directory, rememberedPath)), artifact);
    await writeFile(artifactPath, Buffer.from("changed"));
    expectFailure(run(root, "release", directory, rememberedPath), "ARTIFACT_MISMATCH");
    await writeFile(artifactPath, artifact);

    const forkReceipt = await withAgent(root, fork, "recipient", (client) =>
      call(client, "handshake_accept", terms),
    );
    assert.notEqual(forkReceipt.head, accepted.head);
    assert.deepEqual(successfulResult(run(root, "release", fork)), artifact);
    const forkReceiptPath = join(fork, "receipt.json");
    const forkBytes = await readFile(forkReceiptPath);
    expectFailure(run(root, "release", fork, rememberedPath), "DIVERGED_HEAD");
    assert.deepEqual(await readFile(forkReceiptPath), forkBytes);
    assert.deepEqual(await readFile(receiptPath), receiptBytes);

    const corrupted = JSON.parse(receiptBytes);
    const last = corrupted.commits.at(-1);
    last.signature = `${last.signature.startsWith("A") ? "B" : "A"}${last.signature.slice(1)}`;
    await writeFile(receiptPath, JSON.stringify(corrupted));
    expectFailure(run(root, "release", directory, rememberedPath), "SIGNATURE_INVALID");

    await writeFile(receiptPath, await readFile(proposalPath));
    expectFailure(run(root, "release", directory, rememberedPath), "STALE_HEAD");
    assert.deepEqual(await readFile(rememberedPath), receiptBytes);
  },
);

test("competing proposals preserve the published snapshot and any signed candidate", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ternent-handshake-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "handoff");
  const artifact = join(root, "artifact.txt");
  await writeFile(artifact, "artifact");
  successfulResult(run(root, "init", directory, artifact));

  const proposal = { name: "handshake_propose", arguments: {} };
  const attempts = await withAgent(root, directory, "sender", (first) =>
    withAgent(root, directory, "sender", (second) =>
      Promise.all([first.callTool(proposal), second.callTool(proposal)]),
    ),
  );
  const published = attempts.filter((attempt) => !attempt.isError);
  assert.equal(published.length, 1);
  const rejection = attempts.find((attempt) => attempt.isError);
  assert.ok(rejection);
  const message = JSON.stringify(rejection.content);
  assert.match(message, /SNAPSHOT_EXISTS|DIVERGED_HEAD/);

  const reviewer = join(directory, "reviewer.key");
  const setup = join(directory, "setup.json");
  const proposalPath = join(directory, "proposal.json");
  const winner = JSON.parse(successfulResult(run(root, "verify", proposalPath, reviewer, setup)));
  assert.equal(winner.head, published[0].structuredContent.head);
  const candidates = (await readdir(directory)).filter((name) => name.startsWith(".candidate-"));
  assert.equal(candidates.length, message.includes("DIVERGED_HEAD") ? 1 : 0);
  for (const candidate of candidates) {
    const candidatePath = join(directory, candidate, "snapshot.json");
    const loser = JSON.parse(successfulResult(run(root, "verify", candidatePath, reviewer, setup)));
    assert.notEqual(loser.head, winner.head);
    expectFailure(run(root, "verify", candidatePath, reviewer, proposalPath), "DIVERGED_HEAD");
  }
});
