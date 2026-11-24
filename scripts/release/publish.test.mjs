import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPlan } from "./plan.mjs";
import { publishRelease } from "./publish.mjs";
import { fixture, now, registryFixture } from "./fixtures.mjs";
import { readJson, sha256 } from "./shared.mjs";

/** @param {import('node:test').TestContext} t @param {Parameters<typeof fixture>[0]} [config] */
function setup(t, config) {
  const f = fixture(config);
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const { plan } = createPlan(f.planOptions);
  const remote = registryFixture(plan);
  const journalPath = join(f.root, "journal.json");
  const options = {
    plan,
    directory: f.directory,
    registry: remote.registry,
    now,
    journalPath,
    wait: async () => {},
    verifySeal: async () => {},
    verifyConsumers: async () => {
      assert(
        plan.packages.every(
          (pkg) => remote.versions.get(`${pkg.name}@${pkg.version}`) === pkg.integrity,
        ),
      );
    },
  };
  return { ...f, plan, ...remote, journalPath, options };
}
/** @param {string} code @returns {(error:any)=>boolean} */
const error = (code) => (e) => e.code === code;
const writes = new Set(["publish", "setTag", "removeTag"]);

await test("no-op never contacts npm; absent verification hooks and invalid Seal block all activity", async (t) => {
  const noop = setup(t, { intent: false });
  assert.equal((await publishRelease(noop.options)).status, "noop");
  assert.deepEqual(noop.calls, []);
  const f = setup(t);
  await assert.rejects(
    publishRelease({
      ...f.options,
      verifySeal: async () => {
        throw Error("private cause");
      },
    }),
    error("SEAL_INVALID"),
  );
  assert.deepEqual(f.calls, []);
  await assert.rejects(
    publishRelease({ ...f.options, verifyConsumers: /** @type {any} */ (undefined) }),
    error("HOST_CONFIGURATION"),
  );
  assert.deepEqual(f.calls, []);
});

await test("all collisions are checked before any write, including a later dependent", async (t) => {
  const f = setup(t);
  const last = f.plan.packages.at(-1);
  assert(last);
  f.versions.set(`${last.name}@${last.version}`, "sha512-different");
  await assert.rejects(publishRelease(f.options), error("VERSION_COLLISION"));
  assert(!f.calls.some((call) => writes.has(call[0])));
  const journal = readJson(f.journalPath);
  assert.equal(journal.status, "incomplete");
  assert.equal(journal.error.code, "VERSION_COLLISION");
});

await test("identical registry bytes skip publication and next cannot be downgraded", async (t) => {
  const f = setup(t);
  for (const pkg of f.plan.packages) f.versions.set(`${pkg.name}@${pkg.version}`, pkg.integrity);
  assert.equal((await publishRelease(f.options)).status, "complete");
  assert(!f.calls.some((call) => call[0] === "publish"));
  f.calls.length = 0;
  assert.equal((await publishRelease(f.options)).status, "complete");
  assert(!f.calls.some((call) => writes.has(call[0])));
  assert.equal(readJson(f.journalPath).attempt, 2);
  const old = setup(t);
  old.tags.set(old.plan.packages[0].name, "2.0.0");
  await assert.rejects(publishRelease(old.options), error("CHANNEL_DOWNGRADE"));
  assert(!old.calls.some((call) => writes.has(call[0])));
});

await test("partial dependency publication retains bytes and retries missing packages in order", async (t) => {
  const f = setup(t);
  const publish = f.registry.publish;
  let failed = false;
  f.registry.publish = async (pkg, file, tag) => {
    if (pkg.name === f.plan.packages[1].name && !failed) {
      failed = true;
      throw Error("transient publish failure");
    }
    await publish(pkg, file, tag);
  };
  await assert.rejects(publishRelease(f.options), error("PUBLISH_PARTIAL"));
  assert.equal(f.versions.size, 1);
  assert(!f.calls.some((call) => call[0] === "setTag"));
  const first = f.plan.packages[0];
  assert.equal(sha256(readFileSync(join(f.directory, first.tarball))), first.sha256);
  assert.equal((await publishRelease(f.options)).status, "complete");
  assert.equal(f.calls.filter((call) => call[0] === "publish" && call[1] === first.name).length, 1);
  assert.deepEqual(
    f.calls.filter((call) => call[0] === "publish").map((call) => call[1]),
    f.plan.packages.map((pkg) => pkg.name),
  );
  assert.equal(readJson(f.journalPath).attempt, 2);
});

await test("publish response loss resumes by observed integrity rather than republishing", async (t) => {
  const f = setup(t);
  const publish = f.registry.publish;
  let first = true;
  f.registry.publish = async (...args) => {
    await publish(...args);
    if (first) {
      first = false;
      throw Error("lost response");
    }
  };
  await assert.rejects(publishRelease(f.options), error("PUBLISH_PARTIAL"));
  assert.equal((await publishRelease(f.options)).status, "complete");
  assert.equal(f.calls.filter((call) => call[0] === "publish").length, 5);
});

await test("bounded propagation waits then fails explicitly without any next promotion", async (t) => {
  const f = setup(t);
  f.registry.getVersion = async () => null;
  const waits = [];
  await assert.rejects(
    publishRelease({
      ...f.options,
      attempts: 3,
      wait: async (ms) => {
        waits.push(ms);
      },
    }),
    error("REGISTRY_UNAVAILABLE"),
  );
  assert.equal(waits.length, 2);
  assert(!f.calls.some((call) => call[0] === "setTag"));
  assert.equal(readJson(f.journalPath).status, "incomplete");
});

await test("registry visibility can lag by minutes without duplicate publishes or early promotion", async (t) => {
  const f = setup(t);
  let elapsed = 0;
  /** @type {Map<string,number>} */ const publishedAt = new Map();
  /** @type {number[]} */ const waits = [];
  const publish = f.registry.publish;
  f.registry.publish = async (pkg, file, tag) => {
    await publish(pkg, file, tag);
    publishedAt.set(pkg.name, elapsed);
  };
  f.registry.getVersion = async (name, version) => {
    const value = f.versions.get(`${name}@${version}`),
      start = publishedAt.get(name);
    return value && start !== undefined && elapsed - start >= 180_000 ? { integrity: value } : null;
  };
  const result = await publishRelease({
    ...f.options,
    wait: async (ms) => {
      waits.push(ms);
      elapsed += ms;
    },
    verifyConsumers: async () => {
      for (const pkg of f.plan.packages) assert(await f.registry.getVersion(pkg.name, pkg.version));
      await f.options.verifyConsumers();
    },
  });
  assert.equal(result.status, "complete");
  assert(waits.every((ms) => ms <= 60_000));
  assert.equal(f.calls.filter((call) => call[0] === "publish").length, 5);
  assert.equal(f.calls.filter((call) => call[0] === "setTag").length, 5);
});

await test("channel changes are verified after delayed registry visibility", async (t) => {
  const f = setup(t);
  let elapsed = 0;
  const visible = new Map(f.tags);
  /** @type {Map<string,{version:string,at:number}>} */ const pending = new Map();
  const setTag = f.registry.setTag;
  f.registry.setTag = async (name, version, tag) => {
    await setTag(name, version, tag);
    pending.set(name, { version, at: elapsed + 180_000 });
  };
  f.registry.getTag = async (name) => {
    const update = pending.get(name);
    if (update && elapsed >= update.at) visible.set(name, update.version);
    return visible.get(name) ?? null;
  };
  assert.equal(
    (
      await publishRelease({
        ...f.options,
        wait: async (ms) => {
          elapsed += ms;
        },
      })
    ).status,
    "complete",
  );
  assert([...visible.values()].every((version) => version === "1.0.0-alpha.0"));
});

await test("lost promotion responses are compensated even when reads still show the previous tag", async (t) => {
  const f = setup(t);
  const setTag = f.registry.setTag;
  f.registry.getTag = async () => "0.9.0";
  f.registry.setTag = async (name, version, tag) => {
    await setTag(name, version, tag);
    if (version === "1.0.0-alpha.0") throw new Error("response lost before cache update");
  };
  await assert.rejects(publishRelease(f.options), error("PROMOTION_PARTIAL"));
  assert([...f.tags.values()].every((version) => version === "0.9.0"));
  assert.equal(readJson(f.journalPath).packages[f.plan.packages[0].name].promotion, "restored");
});

await test("published-consumer hook is mandatory and runs before channel promotion", async (t) => {
  const f = setup(t);
  let consumers = 0;
  await assert.rejects(
    publishRelease({
      ...f.options,
      verifyConsumers: async () => {
        consumers++;
        assert.equal(f.versions.size, 5);
        assert(!f.calls.some((call) => call[0] === "setTag"));
        throw Error("bad installed consumer");
      },
    }),
    error("CONSUMER_FAILED"),
  );
  assert.equal(consumers, 1);
  assert.equal(f.versions.size, 5);
  assert(!f.calls.some((call) => call[0] === "setTag"));
});

await test("proof corruption during consumers blocks promotion while retaining candidate publications", async (t) => {
  const f = setup(t);
  const proof = join(f.directory, "release-proof.json");
  writeFileSync(proof, "verified proof");
  let sealChecks = 0;
  await assert.rejects(
    publishRelease({
      ...f.options,
      verifySeal: async () => {
        sealChecks++;
        assert.equal(readFileSync(proof, "utf8"), "verified proof");
      },
      verifyConsumers: async () => {
        await f.options.verifyConsumers();
        writeFileSync(proof, "corrupted proof");
      },
    }),
    error("SEAL_INVALID"),
  );
  assert.equal(sealChecks, 2);
  assert.equal(f.versions.size, 5);
  assert.equal(f.calls.filter((call) => call[0] === "publish").length, 5);
  assert(
    f.calls
      .filter((call) => call[0] === "publish")
      .every((call) => call[3] === `candidate-${f.plan.releaseId}`),
  );
  assert(!f.calls.some((call) => call[0] === "setTag" || call[0] === "removeTag"));
  assert([...f.tags.values()].every((tag) => tag === "0.9.0"));
  const journal = readJson(f.journalPath);
  assert.equal(journal.status, "incomplete");
  assert.equal(journal.error.code, "SEAL_INVALID");
  assert(Object.values(journal.packages).every((state) => state.state === "published"));
});

await test("promotion interruption restores prior channels and retry completes without new publish", async (t) => {
  const f = setup(t);
  const setTag = f.registry.setTag;
  let fail = true;
  f.registry.setTag = async (name, version, tag) => {
    if (name === f.plan.packages[1].name && version === f.plan.packages[1].version && fail) {
      fail = false;
      throw Error("interrupted promotion");
    }
    await setTag(name, version, tag);
  };
  await assert.rejects(publishRelease(f.options), error("PROMOTION_PARTIAL"));
  assert([...f.tags.values()].every((tag) => tag === "0.9.0"));
  assert.equal(readJson(f.journalPath).status, "incomplete");
  f.calls.length = 0;
  assert.equal((await publishRelease(f.options)).status, "complete");
  assert(!f.calls.some((call) => call[0] === "publish"));
  assert([...f.tags.values()].every((tag) => tag === "1.0.0-alpha.0"));
});

await test("lost promotion response is restored and absent previous channels are removed", async (t) => {
  const f = setup(t);
  f.tags.clear();
  const setTag = f.registry.setTag;
  let first = true;
  f.registry.setTag = async (...args) => {
    await setTag(...args);
    if (first) {
      first = false;
      throw Error("lost tag response");
    }
  };
  await assert.rejects(publishRelease(f.options), error("PROMOTION_PARTIAL"));
  assert.equal(f.tags.size, 0);
  assert(f.calls.some((call) => call[0] === "removeTag"));
});

await test("failed restoration is reported incomplete and does not claim release success", async (t) => {
  const f = setup(t);
  const setTag = f.registry.setTag;
  f.registry.setTag = async (name, version, tag) => {
    if (version === "0.9.0" || name === f.plan.packages[1].name) throw Error("tag outage");
    await setTag(name, version, tag);
  };
  await assert.rejects(publishRelease(f.options), error("PROMOTION_PARTIAL"));
  const journal = readJson(f.journalPath);
  assert.equal(journal.status, "incomplete");
  assert.equal(journal.packages[f.plan.packages[0].name].promotion, "restore-failed");
  assert.notEqual(journal.phase, "complete");
});

await test("tampering before publish and after Seal is rejected without registry mutations", async (t) => {
  const f = setup(t);
  await assert.rejects(
    publishRelease({
      ...f.options,
      verifySeal: async () =>
        writeFileSync(join(f.directory, f.plan.packages[0].tarball), "changed"),
    }),
    error("DIGEST_MISMATCH"),
  );
  assert.deepEqual(f.calls, []);
});

await test("retry rejects a newer channel before writes even with a saved earlier baseline", async (t) => {
  const f = setup(t);
  await assert.rejects(
    publishRelease({
      ...f.options,
      verifyConsumers: async () => {
        throw Error("retry later");
      },
    }),
    error("CONSUMER_FAILED"),
  );
  f.tags.set(f.plan.packages[0].name, "2.0.0");
  f.calls.length = 0;
  await assert.rejects(publishRelease(f.options), error("CHANNEL_DOWNGRADE"));
  assert(!f.calls.some((call) => writes.has(call[0])));
});

await test("failure context is structured and journals cannot be placed in the signed bundle", async (t) => {
  const f = setup(t);
  f.registry.publish = async () => {
    throw Error("secret host detail");
  };
  await assert.rejects(
    publishRelease(f.options),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "PUBLISH_PARTIAL" &&
      "sourceSha" in error &&
      error.sourceSha === f.plan.sourceSha &&
      "releaseId" in error &&
      error.releaseId === f.plan.releaseId &&
      "phase" in error &&
      error.phase === "publish" &&
      "retryable" in error &&
      error.retryable === true &&
      !error.message.includes("secret"),
  );
  await assert.rejects(
    publishRelease({ ...f.options, journalPath: join(f.directory, "..journal.json") }),
    error("PATH_INVALID"),
  );
});

await test("stable publication verifies consumers before latest promotion and never changes next", async (t) => {
  const f = setup(t, { channel: "latest" });
  let consumers = 0;
  const result = await publishRelease({
    ...f.options,
    verifyConsumers: async () => {
      consumers++;
      assert.equal(f.versions.size, 5);
      assert(!f.calls.some((call) => call[0] === "setTag"));
    },
  });
  assert.equal(result.status, "complete");
  assert.equal(result.channel, "latest");
  assert.equal(consumers, 1);
  assert(f.calls.filter((call) => call[0] === "getTag").every((call) => call[2] === "latest"));
  assert(f.calls.filter((call) => call[0] === "setTag").every((call) => call[3] === "latest"));
  assert([...f.tags.values()].every((tag) => tag === "1.0.0"));
  assert.equal(readJson(f.journalPath).channel, "latest");
});

await test("failed latest promotion restores latest and retries without publishing new bytes", async (t) => {
  const f = setup(t, { channel: "latest" });
  const setTag = f.registry.setTag;
  let interrupted = false;
  f.registry.setTag = async (name, version, tag) => {
    await setTag(name, version, tag);
    if (!interrupted && name === f.plan.packages[1].name && version === "1.0.0") {
      interrupted = true;
      throw new Error("lost response");
    }
  };
  await assert.rejects(publishRelease(f.options), error("PROMOTION_PARTIAL"));
  assert([...f.tags.values()].every((tag) => tag === "0.9.0"));
  assert(f.calls.filter((call) => call[0] === "setTag").every((call) => call[3] === "latest"));
  const published = f.calls.filter((call) => call[0] === "publish").length;
  assert.equal((await publishRelease(f.options)).status, "complete");
  assert.equal(f.calls.filter((call) => call[0] === "publish").length, published);
  assert([...f.tags.values()].every((tag) => tag === "1.0.0"));
});
