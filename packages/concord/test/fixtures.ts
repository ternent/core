import { readFileSync } from "node:fs";
import { createHash, createPrivateKey, sign } from "node:crypto";
import type { Json, Snapshot, CommitSubject, EntrySubject } from "../src/protocol/index.js";
export function vector<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../docs/concord/vectors/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
export const seed = Uint8Array.from(
  Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"),
);
// Independent fixture author: Node crypto and a small encoder for trusted test values.
export function reference(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(reference).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${reference((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}
export const encoded = (value: unknown) => new TextEncoder().encode(reference(value));
export const base64 = (value: Uint8Array) => Buffer.from(value).toString("base64url");
export const decoded = (value: string) => new Uint8Array(Buffer.from(value, "base64url"));
export function hash(subject: EntrySubject, kind: "entry"): `entry:${string}`;
export function hash(subject: CommitSubject, kind: "commit"): `commit:${string}`;
export function hash(
  subject: EntrySubject | CommitSubject,
  kind: "entry" | "commit",
): `entry:${string}` | `commit:${string}` {
  return `${kind}:${createHash("sha256").update(`concord.${kind}/1\0`).update(reference(subject)).digest("hex")}`;
}
export function referenceSignature(subject: CommitSubject, seedBytes: Uint8Array): string {
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(seedBytes),
    ]),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, Buffer.from(`concord.signature/1\0${reference(subject)}`), key).toString(
    "base64url",
  );
}
export function resign(wire: Snapshot): Snapshot {
  let index = 0;
  for (let i = 0; i < wire.commits.length; i++) {
    const commit = wire.commits[i];
    const subjects = commit.subject.entryIds.map(() => wire.entries[index++]);
    commit.subject.entryIds = subjects.map((entry) => {
      entry.id = hash(entry.subject, "entry");
      return entry.id;
    });
    commit.id = hash(commit.subject, "commit");
    commit.signature = referenceSignature(commit.subject, seed);
  }
  wire.documentId = wire.commits[0].id;
  wire.head = wire.commits.at(-1)!.id;
  return wire;
}
export type Mutation = {
  id: string;
  operations: { op: string; path: string; from?: string; value?: Json }[];
  expected: { integrity: string; code: string };
};
export function mutate(source: Snapshot, operations: Mutation["operations"]): Snapshot {
  const root = structuredClone(source) as unknown as Json;
  function location(pointer: string): { parent: Json[] | Record<string, Json>; key: string } {
    const parts = pointer
      .slice(1)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
    let parent = root;
    for (const part of parts.slice(0, -1)) parent = (parent as Record<string, Json>)[part];
    return { parent: parent as Json[] | Record<string, Json>, key: parts.at(-1)! };
  }
  function remove(pointer: string): Json {
    const { parent, key } = location(pointer);
    if (Array.isArray(parent)) return parent.splice(Number(key), 1)[0];
    const value = parent[key];
    delete parent[key];
    return value;
  }
  for (const operation of operations) {
    if (operation.op === "remove") {
      remove(operation.path);
      continue;
    }
    const value =
      operation.op === "move" ? remove(operation.from!) : structuredClone(operation.value!);
    const { parent, key } = location(operation.path);
    if (Array.isArray(parent) && operation.op !== "replace")
      parent.splice(key === "-" ? parent.length : Number(key), 0, value);
    else (parent as Record<string, Json>)[key] = value;
  }
  return root as unknown as Snapshot;
}
