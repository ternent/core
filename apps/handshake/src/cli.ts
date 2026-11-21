#!/usr/bin/env node
import {
  createHandoffOperations,
  initializeHandoff,
  releaseArtifact,
  verifyReceipt,
} from "./handoff.js";

const usage = `Usage:
  ternent-handshake init <new-directory> <artifact>
  ternent-handshake mcp <directory> <sender|recipient>
  ternent-handshake verify <snapshot> <reviewer-key> [remembered-snapshot]
  ternent-handshake release <directory> [remembered-snapshot]`;

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main([command, first, second, third, ...rest]: string[]) {
  if (command === "--help" && !first) {
    process.stdout.write(`${usage}\n`);
  } else if (command === "init" && first && second && !third) {
    print(await initializeHandoff(first, second));
  } else if (
    command === "mcp" &&
    first &&
    (second === "sender" || second === "recipient") &&
    !third
  ) {
    const { serveHandshakeMcp } = await import("./mcp.js");
    serveHandshakeMcp(await createHandoffOperations(first, second));
  } else if (command === "verify" && first && second && !rest.length) {
    print(await verifyReceipt(first, second, third));
  } else if (command === "release" && first && !third) {
    process.stdout.write(await releaseArtifact(first, second));
  } else {
    throw new Error(usage);
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
