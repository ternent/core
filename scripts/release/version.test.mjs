import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAllocations } from "./version.mjs";

await test("version allocation checks observed registry history before changing manifests", async () => {
  const releases = [{ name: "@ternent/identity", newVersion: "0.7.0-alpha.0" }];
  await validateAllocations(releases, async () => ["0.6.0", "not-a-version"]);
  await assert.rejects(
    () => validateAllocations(releases, async () => ["0.7.0-alpha.0"]),
    /VERSION_ALREADY_EXISTS/,
  );
  await assert.rejects(
    () => validateAllocations(releases, async () => ["1.0.0"]),
    /VERSION_SEQUENCE_RESET/,
  );
  await assert.rejects(
    () => validateAllocations([{ name: "@ternent/identity", newVersion: "1.0.0" }], async () => []),
    /ALPHA_VERSION_REQUIRED/,
  );
  await assert.rejects(() => validateAllocations([], async () => []), /VERSION_INTENT_EMPTY/);
});
