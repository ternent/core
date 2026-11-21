import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { createManifestArtifact } from "../src/commands/manifest.js";

import {
  parseSealManifestJson,
  stringifySealManifest,
  type SealManifestV1,
} from "../src/manifest.js";
import { sealVector } from "./fixtures.js";

async function createFixtureTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "seal-manifest-"));
  await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "a.txt"), "alpha\n", "utf8");
  await writeFile(join(root, ".DS_Store"), "ignore", "utf8");
  await writeFile(join(root, "nested", "b.txt"), "beta\n", "utf8");
  return root;
}

describe("manifest command", () => {
  it("is deterministic across runs", async () => {
    const fixtureRoot = await createFixtureTree();
    const first = await createManifestArtifact(fixtureRoot);
    const second = await createManifestArtifact(fixtureRoot);

    expect(first.content).toBe(second.content);
    expect(first.manifest).toEqual(second.manifest);
  });

  it("excludes .DS_Store and sorts file keys", async () => {
    const fixtureRoot = await createFixtureTree();
    const { manifest } = await createManifestArtifact(fixtureRoot);

    expect(Object.keys(manifest.files)).toEqual(["a.txt", "nested/b.txt"]);
  });
});

describe("portable manifest boundaries", () => {
  it("preserves numeric and prototype-like filenames in the saved canonical manifest", () => {
    const fixed = sealVector();
    expect(stringifySealManifest(fixed.manifest)).toBe(fixed.canonicalManifest);
    const parsed = parseSealManifestJson(fixed.canonicalManifest);
    expect(parsed.ok).toBe(true);
    expect(parsed.manifest).toEqual(fixed.manifest);
    expect(Object.hasOwn(parsed.manifest!.files, "__proto__")).toBe(true);
    expect(Object.keys(JSON.parse(fixed.canonicalManifest).files).slice(0, 2)).toEqual(["2", "10"]);
  });

  it("includes real files named __proto__, constructor and integer keys without prototype mutation", async () => {
    const root = await createFixtureTree();
    for (const name of ["__proto__", "constructor", "2", "10"])
      await writeFile(join(root, name), `content:${name}`, "utf8");
    const { manifest, content } = await createManifestArtifact(root);
    for (const name of ["__proto__", "constructor", "2", "10"]) {
      expect(Object.hasOwn(manifest.files, name)).toBe(true);
      expect(manifest.files[name]).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(Object.hasOwn(JSON.parse(content).files, name)).toBe(true);
    }
    expect(parseSealManifestJson(content).manifest).toEqual(manifest);
  });

  it("rejects values that cannot participate in the strict canonical JSON contract", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse: unknown[] = [];
    sparse.length = 1;
    const customArray = Object.setPrototypeOf(["value"], null) as unknown[];
    class ArraySubclass extends Array<unknown> {}
    const invalid = [
      { value: undefined },
      { value: NaN },
      { value: Infinity },
      { value: -0 },
      { value: Number.MAX_SAFE_INTEGER + 1 },
      { value: 1n },
      { value: () => "hidden" },
      { value: "unpaired-\ud800" },
      sparse,
      customArray,
      new ArraySubclass(),
      [undefined],
      cyclic,
      Object.create({ inherited: true }),
      new Date("2026-11-20T00:00:00.000Z"),
    ];
    for (const input of invalid)
      expect(() => stringifySealManifest(input as unknown as SealManifestV1)).toThrow();
    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 65; index++) deep = { nested: deep };
    expect(() => stringifySealManifest(deep as unknown as SealManifestV1)).toThrow();
  });

  it("does not execute getters or toJSON while rejecting host objects", () => {
    const getter = vi.fn(() => "must not execute");
    const hostile = {};
    Object.defineProperty(hostile, "secret", { enumerable: true, get: getter });
    expect(() => stringifySealManifest(hostile as SealManifestV1)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(() => ({ hidden: "must not execute" }));
    expect(() => stringifySealManifest({ toJSON } as unknown as SealManifestV1)).toThrow();
    expect(toJSON).not.toHaveBeenCalled();
  });
});
