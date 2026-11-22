import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fork Verdaccio: synchronous package-manager calls must not block its HTTP loop.
 * @param {string} logFile
 */
export async function startCandidateRegistry(logFile) {
  const directory = mkdtempSync(join(tmpdir(), "ternent-candidate-registry-"));
  let log;
  /** @type {import("node:child_process").ChildProcess | undefined} */
  let child;
  let stopped = false;
  async function close() {
    if (stopped) return;
    stopped = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise((resolveExit) => {
        assert(child);
        const force = setTimeout(() => child?.kill("SIGKILL"), 5_000);
        child.once("exit", () => {
          clearTimeout(force);
          resolveExit(undefined);
        });
        child.kill("SIGTERM");
      });
    }
    rmSync(directory, { recursive: true, force: true });
  }
  try {
    const config = join(directory, "config.yaml");
    writeFileSync(
      config,
      JSON.stringify({
        storage: join(directory, "storage"),
        auth: { htpasswd: { file: join(directory, "htpasswd"), max_users: -1 } },
        uplinks: {},
        packages: {
          "@ternent/*": { access: "$all", publish: "$all" },
          "@ternent-verify/*": { access: "$all", publish: "$all" },
        },
        log: { type: "stdout", format: "json", level: "warn" },
      }),
    );
    log = openSync(logFile, "w");
    child = fork(fileURLToPath(import.meta.url), ["--child", config], {
      cwd: directory,
      execArgv: [],
      stdio: ["ignore", log, log, "ipc"],
      env: { ...process.env, VERDACCIO_TELEMETRY: "false" },
    });
    const url = await new Promise((resolveReady, reject) => {
      /** @param {Error} error */
      function failed(error) {
        clearTimeout(timeout);
        reject(error);
      }
      const timeout = setTimeout(
        () => failed(new Error(`Registry startup timed out; see ${logFile}`)),
        30_000,
      );
      assert(child);
      child.once("error", failed);
      child.once("exit", (code, signal) =>
        failed(new Error(`Registry exited (${code ?? signal}); see ${logFile}`)),
      );
      child.once("message", (message) => {
        clearTimeout(timeout);
        if (
          !message ||
          typeof message !== "object" ||
          !("url" in message) ||
          typeof message.url !== "string"
        ) {
          failed(new Error("Registry sent an invalid startup message"));
          return;
        }
        resolveReady(message.url);
      });
    });
    assert(typeof url === "string");
    const endpoint = new URL(url);
    assert.equal(endpoint.protocol, "http:");
    assert.equal(endpoint.hostname, "127.0.0.1");
    assert(endpoint.port);
    assert.equal(
      (await fetch(`${url}/-/ping`, { signal: AbortSignal.timeout(5_000) })).status,
      200,
    );
    return { url, close };
  } catch (error) {
    await close();
    throw error;
  } finally {
    if (log !== undefined) closeSync(log);
  }
}

if (process.argv[2] === "--child") {
  // Verdaccio 7's declarations reference an undeclared @verdaccio/types dependency.
  // Keep that upstream typing defect outside root checks; the pinned runtime is exercised here.
  const { runServer } = createRequire(import.meta.url)("verdaccio");
  const app = await runServer(process.argv[3]);
  const server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    assert(address && typeof address !== "string");
    process.send?.({ url: `http://127.0.0.1:${address.port}` });
  });
  process.once("disconnect", () => server.close(() => process.exit(0)));
}
