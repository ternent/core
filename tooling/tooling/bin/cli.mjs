#!/usr/bin/env node
import { resolve } from "node:path";
import { validatePackage } from "../src/validation.mjs";

const [command, directory = ".", ...flags] = process.argv.slice(2);
if (command !== "validate" || flags.some((flag) => flag !== "--built")) {
  console.error("Usage: ternent-tooling validate <package-directory> [--built]");
  process.exitCode = 2;
} else {
  try {
    const findings = validatePackage(resolve(directory), { built: flags.includes("--built") });
    console.log(JSON.stringify({ package: resolve(directory), findings }));
    if (findings.length) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ code: "VALIDATION_FAILED", message: String(error) }));
    process.exitCode = 1;
  }
}
