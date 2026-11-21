import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import semver from "semver";
import { packageNames, registryUrl, ReleaseError, requireThat } from "./shared.mjs";

/** @typedef {{code:number,stdout:string,stderr:string}} CommandResult */
/** @param {string[]} args @returns {Promise<CommandResult>} */
function npm(args) {
  return new Promise((done) =>
    execFile(
      "npm",
      args,
      {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          NPM_CONFIG_USERCONFIG: "/dev/null",
          NPM_CONFIG_IGNORE_SCRIPTS: "true",
        },
      },
      (error, stdout, stderr) => done({ code: error ? 1 : 0, stdout, stderr }),
    ),
  );
}
/**
 * Fixed-registry argv adapter. Mutations are denied unless the trusted entrypoint authorizes each.
 * @param {{run?:(args:string[])=>Promise<CommandResult>,authorize?:()=>Promise<void>|void}} [options]
 * @returns {import('./publish.mjs').RegistryAdapter}
 */
export function createNpmRegistryAdapter(options = {}) {
  const run = options.run ?? npm;
  /** @param {string} name @param {string} [version] */
  function identity(name, version) {
    requireThat(
      packageNames.includes(name) && (version === undefined || semver.valid(version) === version),
      "PLAN_INVALID",
      "Invalid npm package selector",
    );
  }
  /** @param {string[]} args */
  async function read(args) {
    const result = await run([...args, "--json", "--registry", registryUrl]);
    let value;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      throw new ReleaseError("REGISTRY_UNAVAILABLE", "Registry query did not return JSON");
    }
    if (result.code !== 0) {
      if (value?.error?.code === "E404") return null;
      throw new ReleaseError("REGISTRY_UNAVAILABLE", "Registry query failed");
    }
    return value;
  }
  /** @param {string[]} args */
  async function write(args) {
    requireThat(
      typeof options.authorize === "function",
      "RELEASE_NOT_ENABLED",
      "Live npm mutation is not enabled",
    );
    await options.authorize();
    const result = await run([...args, "--registry", registryUrl]);
    requireThat(
      result.code === 0,
      "REGISTRY_UNAVAILABLE",
      "npm mutation failed; inspect trusted runner diagnostics",
    );
  }
  return {
    async getVersion(name, version) {
      identity(name, version);
      const value = await read(["view", `${name}@${version}`, "dist.integrity"]);
      if (value === null) return null;
      requireThat(
        typeof value === "string" && /^sha512-[A-Za-z0-9+/]{86}==$/.test(value),
        "REGISTRY_INVALID",
        "Registry version has no usable sha512 integrity",
      );
      return { integrity: value };
    },
    async getTag(name, tag) {
      identity(name);
      requireThat(tag === "next", "PLAN_INVALID", "Only the next channel is supported");
      const value = await read(["view", name, "dist-tags"]);
      if (value === null) return null;
      requireThat(
        value && typeof value === "object" && !Array.isArray(value),
        "REGISTRY_INVALID",
        "Registry tags are invalid",
      );
      return value.next ?? null;
    },
    async publish(pkg, tarball, tag) {
      identity(pkg.name, pkg.version);
      requireThat(
        isAbsolute(tarball) && tarball.endsWith(".tgz") && /^candidate-[0-9a-f]{64}$/.test(tag),
        "PLAN_INVALID",
        "Invalid retained tarball publication",
      );
      await write([
        "publish",
        tarball,
        "--access",
        "public",
        "--tag",
        tag,
        "--ignore-scripts",
        "--provenance",
      ]);
    },
    async setTag(name, version, tag) {
      identity(name, version);
      requireThat(tag === "next", "PLAN_INVALID", "Only next can be promoted");
      await write(["dist-tag", "add", `${name}@${version}`, tag]);
    },
    async removeTag(name, tag) {
      identity(name);
      requireThat(tag === "next", "PLAN_INVALID", "Only next can be restored");
      await write(["dist-tag", "rm", name, tag]);
    },
  };
}
