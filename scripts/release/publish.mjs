import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import semver from "semver";
import { validatePlan } from "./plan.mjs";
import {
  artifactPath,
  jcs,
  readJson,
  ReleaseError,
  requireThat,
  sha256,
  writeJson,
} from "./shared.mjs";

/** @typedef {import('./shared.mjs').ReleasePlan} ReleasePlan */
/** @typedef {import('./shared.mjs').ReleasePackage} ReleasePackage */
/** @typedef {{getVersion:(name:string,version:string)=>Promise<{integrity:string}|null>,getTag:(name:string,tag:string)=>Promise<string|null>,publish:(pkg:ReleasePackage,tarball:string,tag:string)=>Promise<void>,setTag:(name:string,version:string,tag:string)=>Promise<void>,removeTag:(name:string,tag:string)=>Promise<void>}} RegistryAdapter */
/** @template T @param {T} value @returns {T} */
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** @param {unknown} error @param {string} code @param {string} message */
function failure(error, code, message) {
  return error instanceof ReleaseError ? error : new ReleaseError(code, message);
}

/**
 * Publish verified retained bytes. The consumer hook is mandatory; no default can certify consumers.
 * Journal/receipts stay outside the release bundle and remote truth is rechecked on every retry.
 * @param {{plan:ReleasePlan,directory:string,registry:RegistryAdapter,verifyConsumers:(plan:ReleasePlan)=>Promise<void>,journalPath?:string,expectedSourceSha?:string,now?:Date,attempts?:number,wait?:(ms:number)=>Promise<void>}} options
 */
async function publishVerifiedRelease(options) {
  const now = options.now ?? new Date(),
    directory = resolve(options.directory);
  const plan = freeze(
    validatePlan(JSON.parse(jcs(options.plan)), {
      directory,
      expectedSourceSha: options.expectedSourceSha,
      now,
    }),
  );
  const channel = plan.channel;
  requireThat(
    typeof options.verifyConsumers === "function",
    "HOST_CONFIGURATION",
    "The published-consumer verification hook is required",
  );
  validatePlan(plan, { directory, now });
  if (!plan.packages.length)
    return {
      schema: 1,
      channel,
      releaseId: plan.releaseId,
      sourceSha: plan.sourceSha,
      status: "noop",
      phase: "noop",
      retryable: false,
      packages: [],
    };
  const attempts = options.attempts ?? 10;
  requireThat(
    Number.isSafeInteger(attempts) && attempts >= 1 && attempts <= 10,
    "HOST_CONFIGURATION",
    "Invalid propagation retry limit",
  );
  const wait = options.wait ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  /** @param {()=>Promise<boolean>} check */
  async function waitForRegistry(check) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await check()) return true;
      if (attempt + 1 < attempts) await wait(Math.min(2_000 * 2 ** attempt, 60_000));
    }
    return false;
  }
  const journalPath = resolve(
    options.journalPath ??
      resolve(dirname(directory), "release-journals", `${plan.releaseId}.json`),
  );
  const local = relative(directory, journalPath);
  requireThat(
    local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local),
    "PATH_INVALID",
    "Journal must stay outside the release bundle",
  );
  /** @type {any} */
  const journal = existsSync(journalPath)
    ? readJson(journalPath)
    : {
        schema: 1,
        channel,
        releaseId: plan.releaseId,
        sourceSha: plan.sourceSha,
        attempt: 0,
        status: "pending",
        phase: "preflight",
        packages: Object.fromEntries(
          plan.packages.map((pkg) => [
            pkg.name,
            {
              version: pkg.version,
              integrity: pkg.integrity,
              state: "pending",
              publishAttempts: 0,
              observedIntegrity: null,
              previousTag: undefined,
              promotion: "pending",
            },
          ]),
        ),
        history: [],
      };
  requireThat(
    journal.schema === 1 &&
      (journal.channel ?? "next") === channel &&
      journal.releaseId === plan.releaseId &&
      journal.sourceSha === plan.sourceSha &&
      Number.isSafeInteger(journal.attempt) &&
      journal.attempt >= 0 &&
      journal.packages &&
      jcs(Object.keys(journal.packages).sort()) ===
        jcs(plan.packages.map((pkg) => pkg.name).sort()) &&
      Array.isArray(journal.history),
    "JOURNAL_INVALID",
    "Journal does not belong to this release",
  );
  for (const pkg of plan.packages) {
    const state = journal.packages[pkg.name];
    requireThat(
      state.version === pkg.version &&
        state.integrity === pkg.integrity &&
        Number.isSafeInteger(state.publishAttempts) &&
        state.publishAttempts >= 0 &&
        (state.previousTag === undefined ||
          state.previousTag === null ||
          semver.valid(state.previousTag)),
      "JOURNAL_INVALID",
      "Invalid package journal",
    );
  }
  const registry = options.registry;
  const persist = () => writeJson(journalPath, journal);
  journal.attempt++;
  journal.status = "running";
  journal.phase = "preflight";
  delete journal.error;
  persist();
  /** @param {ReleasePackage} pkg */
  async function observed(pkg) {
    const result = await registry.getVersion(pkg.name, pkg.version);
    requireThat(
      result === null || typeof result?.integrity === "string",
      "REGISTRY_INVALID",
      "Registry returned invalid integrity metadata",
    );
    if (result)
      requireThat(
        result.integrity === pkg.integrity,
        "VERSION_COLLISION",
        `Different registry bytes already occupy ${pkg.name}@${pkg.version}`,
      );
    journal.packages[pkg.name].observedIntegrity = result?.integrity ?? null;
    return result;
  }
  /** @param {ReleasePackage} pkg @param {string|null} expected @param {string|null} previous */
  async function channelMatches(pkg, expected, previous) {
    return waitForRegistry(async () => {
      const current = await registry.getTag(pkg.name, channel);
      requireThat(
        current === expected || current === previous,
        "TAG_CONFLICT",
        "Channel changed outside this release",
      );
      return current === expected;
    });
  }
  try {
    // Inspect every version before the first registry mutation, even dependencies later in order.
    const existing = new Map();
    for (const pkg of plan.packages) existing.set(pkg.name, await observed(pkg));
    for (const pkg of plan.packages) {
      const state = journal.packages[pkg.name],
        tag = await registry.getTag(pkg.name, channel);
      requireThat(
        tag === null || semver.valid(tag),
        "REGISTRY_INVALID",
        "Invalid current channel tag",
      );
      requireThat(
        tag === null || !semver.gt(tag, pkg.version),
        "CHANNEL_DOWNGRADE",
        `Refusing to roll ${channel} backward: ${pkg.name}`,
      );
      if (state.previousTag === undefined) state.previousTag = tag;
      else
        requireThat(
          tag === state.previousTag || tag === pkg.version,
          "TAG_CONFLICT",
          `Channel changed outside this release: ${pkg.name}`,
        );
    }
    persist();
    journal.phase = "publish";
    for (const pkg of plan.packages) {
      const state = journal.packages[pkg.name];
      if (!existing.get(pkg.name)) {
        const tarball = artifactPath(directory, pkg.tarball);
        requireThat(
          sha256(readFileSync(tarball)) === pkg.sha256,
          "DIGEST_MISMATCH",
          "Retained candidate changed before publish",
        );
        state.state = "publishing";
        state.publishAttempts++;
        persist();
        await registry.publish(pkg, tarball, `candidate-${plan.releaseId}`);
        const verified = await waitForRegistry(async () => Boolean(await observed(pkg)));
        requireThat(
          verified,
          "REGISTRY_UNAVAILABLE",
          `Published integrity did not propagate for ${pkg.name}`,
        );
        state.state = "published";
      } else state.state = "identical";
      persist();
    }
    journal.phase = "consumers";
    persist();
    try {
      await options.verifyConsumers(plan);
    } catch {
      throw new ReleaseError(
        "CONSUMER_FAILED",
        "Published package consumers failed; channel promotion is blocked",
      );
    }
    // Recheck all retained bytes and registry versions after the external consumer hook.
    validatePlan(plan, { directory, now });
    for (const pkg of plan.packages)
      requireThat(
        await observed(pkg),
        "REGISTRY_UNAVAILABLE",
        "A verified package disappeared before promotion",
      );
    journal.phase = "promote";
    persist();
    /** @type {ReleasePackage[]} */ const touched = [];
    try {
      for (const pkg of plan.packages) {
        const state = journal.packages[pkg.name];
        const current = await registry.getTag(pkg.name, channel);
        if (current !== pkg.version) {
          requireThat(
            current === state.previousTag,
            "TAG_CONFLICT",
            `Channel changed outside this release: ${pkg.name}`,
          );
          state.promotion = "promoting";
          touched.push(pkg);
          persist();
          await registry.setTag(pkg.name, pkg.version, channel);
          requireThat(
            await channelMatches(pkg, pkg.version, state.previousTag),
            "PROMOTION_PARTIAL",
            "Channel promotion could not be verified",
          );
        }
        state.promotion = "promoted";
        persist();
      }
      for (const pkg of plan.packages)
        requireThat(
          await channelMatches(pkg, pkg.version, journal.packages[pkg.name].previousTag),
          "PROMOTION_PARTIAL",
          "Final channel verification failed",
        );
    } catch (error) {
      for (const pkg of touched.reverse()) {
        const state = journal.packages[pkg.name];
        try {
          const current = await registry.getTag(pkg.name, channel);
          requireThat(
            current === pkg.version || current === state.previousTag,
            "TAG_CONFLICT",
            "Refusing to overwrite an external channel change",
          );
          // A cached previous value cannot prove a possibly committed write failed.
          if (state.previousTag === null) await registry.removeTag(pkg.name, channel);
          else await registry.setTag(pkg.name, state.previousTag, channel);
          requireThat(
            await channelMatches(pkg, state.previousTag, pkg.version),
            "PROMOTION_PARTIAL",
            "Channel restoration could not be verified",
          );
          state.promotion = "restored";
        } catch {
          state.promotion = "restore-failed";
        }
        persist();
      }
      throw failure(
        error,
        "PROMOTION_PARTIAL",
        "Channel promotion was interrupted; inspect the journal for restoration results",
      );
    }
    journal.phase = "complete";
    journal.status = "complete";
    journal.history.push({ attempt: journal.attempt, status: "complete" });
    persist();
    return {
      schema: 1,
      channel,
      releaseId: plan.releaseId,
      sourceSha: plan.sourceSha,
      status: "complete",
      phase: "complete",
      retryable: false,
      attempt: journal.attempt,
      packages: plan.packages.map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
        integrity: pkg.integrity,
        ...journal.packages[pkg.name],
      })),
    };
  } catch (error) {
    const result = failure(
      error,
      journal.phase === "publish" ? "PUBLISH_PARTIAL" : "REGISTRY_UNAVAILABLE",
      "Release operation failed; retry the retained artifacts",
    );
    result.phase = journal.phase;
    result.sourceSha = plan.sourceSha;
    result.releaseId = plan.releaseId;
    journal.status = "incomplete";
    journal.error = {
      code: result.code,
      phase: result.phase,
      sourceSha: result.sourceSha,
      releaseId: result.releaseId,
      retryable: result.retryable,
      message: result.message,
    };
    journal.history.push({
      attempt: journal.attempt,
      status: "incomplete",
      phase: journal.phase,
      code: result.code,
    });
    persist();
    throw result;
  }
}

/** @param {Parameters<typeof publishVerifiedRelease>[0]} options */
export async function publishRelease(options) {
  try {
    return await publishVerifiedRelease(options);
  } catch (error) {
    const result = failure(error, "PLAN_INVALID", "Release validation failed");
    result.sourceSha ??= options.plan?.sourceSha;
    result.releaseId ??= options.plan?.releaseId;
    throw result;
  }
}
