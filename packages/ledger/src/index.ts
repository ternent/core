import { sha256 } from "@noble/hashes/sha2.js";
import { base64urlnopad, hex } from "@scure/base";
import { validatePublicIdentity, type Identity } from "@ternent/identity";
import { createSealHash, createSealProof, verifySealProof, type SealProof } from "@ternent/seal";

export type Json = null | boolean | number | string | readonly Json[] | JsonObject;
export type JsonObject = { readonly [key: string]: Json };
export type Signer = Pick<Identity, "publicIdentity" | "sign">;

export type EntryInput = {
  readonly kind: string;
  readonly payload: Json;
  readonly nonce?: string;
  readonly meta?: JsonObject;
};
export type Entry = EntryInput & { readonly id: `entry:${string}`; readonly nonce: string };
export type Commit = {
  readonly id: `commit:${string}`;
  readonly parent: `commit:${string}` | null;
  readonly nonce: string;
  readonly metadata?: JsonObject;
  readonly entries: readonly Entry[];
  readonly proof: SealProof;
};
export type Relationship = "equal" | "ahead" | "behind" | "diverged" | "unrelated";

export interface History {
  readonly documentId: `commit:${string}`;
  readonly head: `commit:${string}`;
  readonly commits: readonly Commit[];
  compare(other: History): Relationship;
  export(): Uint8Array;
}

export interface Writer {
  readonly history: History;
  readonly staged: readonly Entry[];
  append(input: EntryInput | readonly EntryInput[]): void;
  discard(): void;
  commit(metadata?: JsonObject): Promise<History>;
}

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const ENVELOPE = ['{"commits":[', '],"format":"ledger","version":2}'] as const;
const ISSUE = Symbol("issue");
const encoder = new TextEncoder();

type Internals = { records: readonly string[]; size: number; maxBytes: number };
// Module-private access to a history's stored records, so only Ledger can extend one.
let internals: (history: LedgerHistory) => Internals;

class LedgerHistory implements History {
  readonly documentId: `commit:${string}`;
  readonly head: `commit:${string}`;
  readonly commits: readonly Commit[];
  readonly #records: readonly string[];
  readonly #size: number;
  readonly #maxBytes: number;

  constructor(key: symbol, commits: Commit[], records: string[], size: number, maxBytes: number) {
    if (key !== ISSUE) throw new TypeError("Histories come from createLedger or openLedger");
    this.commits = Object.freeze(commits);
    this.documentId = commits[0].id;
    this.head = commits[commits.length - 1].id;
    this.#records = Object.freeze(records);
    this.#size = size;
    this.#maxBytes = maxBytes;
    Object.freeze(this);
  }

  static isIssued(value: unknown): value is LedgerHistory {
    return typeof value === "object" && value !== null && #records in value;
  }

  compare(other: History): Relationship {
    if (!LedgerHistory.isIssued(other)) throw new TypeError("Compare needs a Ledger history");
    const ours = this.commits;
    const theirs = other.commits;
    if (ours[0].id !== theirs[0].id) return "unrelated";
    let shared = 1;
    while (
      shared < ours.length &&
      shared < theirs.length &&
      ours[shared].id === theirs[shared].id
    ) {
      shared += 1;
    }
    if (shared === ours.length && shared === theirs.length) return "equal";
    if (shared === theirs.length) return "ahead";
    if (shared === ours.length) return "behind";
    return "diverged";
  }

  export(): Uint8Array {
    return encoder.encode(`${ENVELOPE[0]}${this.#records.join(",")}${ENVELOPE[1]}`);
  }

  static {
    internals = (history) => ({
      records: history.#records,
      size: history.#size,
      maxBytes: history.#maxBytes,
    });
  }
}

export async function createLedger(input: {
  signer: Signer;
  entries?: readonly EntryInput[];
  metadata?: JsonObject;
  maxBytes?: number;
}): Promise<History> {
  const signer = captureSigner(input.signer);
  const entries = prepareEntries(input.entries ?? [], null, signer.publicIdentity.id, []);
  const metadata = input.metadata === undefined ? undefined : captureObject(input.metadata);
  const maxBytes = resolveMaxBytes(input.maxBytes);
  return appendCommit(null, signer, entries, metadata, maxBytes);
}

export async function openLedger(
  bytes: Uint8Array,
  options: { maxBytes?: number } = {},
): Promise<History> {
  const maxBytes = resolveMaxBytes(options.maxBytes);
  if (!(bytes instanceof Uint8Array)) throw new TypeError("openLedger needs bytes");
  if (bytes.length > maxBytes) throw new RangeError(`Ledger is larger than ${maxBytes} bytes`);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const document: unknown = JSON.parse(text);
  // Accepting only canonical bytes gives each document one representation and
  // rejects duplicate keys, non-canonical numbers and escapes, and a BOM.
  if (canonical(document) !== text) throw new Error("Ledger bytes are not canonical");
  if (
    !hasExactKeys(document, ["commits", "format", "version"]) ||
    document.format !== "ledger" ||
    document.version !== 2 ||
    !Array.isArray(document.commits) ||
    document.commits.length === 0
  ) {
    throw new Error("Not a version 2 ledger");
  }

  const commits: Commit[] = [];
  const records: string[] = [];
  for (const [index, record] of document.commits.entries()) {
    if (!hasExactKeys(record, ["body", "proof"])) throw new Error(`Commit ${index} is malformed`);
    const body = readBody(record.body, commits.at(-1)?.id ?? null);
    const proof = record.proof as SealProof;
    const verification = await verifySealProof(proof, bodyBytes(body));
    if (!verification.valid) throw new Error(`Commit ${index} has an invalid proof`);
    const author = proof.signer.id;
    const entries = body.entries.map((entry) => withId(entry, body.parent, author));
    commits.push(makeCommit(body, entries, proof));
    records.push(canonical(record));
  }
  return new LedgerHistory(ISSUE, commits, records, bytes.length, maxBytes);
}

export function createWriter(history: History, signer: Signer): Writer {
  if (!LedgerHistory.isIssued(history)) throw new TypeError("createWriter needs a Ledger history");
  const author = captureSigner(signer);
  let current = history;
  let staged: readonly Entry[] = Object.freeze([]);
  let committing = false;
  const idle = (action: string) => {
    if (committing) throw new Error(`Cannot ${action} while a commit is in progress`);
  };

  return Object.freeze({
    get history() {
      return current;
    },
    get staged() {
      return staged;
    },
    append(input: EntryInput | readonly EntryInput[]) {
      idle("append");
      const batch = Array.isArray(input) ? input : [input as EntryInput];
      const prepared = prepareEntries(batch, current.head, author.publicIdentity.id, staged);
      if (prepared.length > 0) staged = Object.freeze([...staged, ...prepared]);
    },
    discard() {
      idle("discard");
      staged = Object.freeze([]);
    },
    async commit(metadata?: JsonObject) {
      idle("commit");
      if (staged.length === 0) throw new Error("Nothing is staged");
      const captured = metadata === undefined ? undefined : captureObject(metadata);
      committing = true;
      try {
        current = await appendCommit(current, author, staged, captured);
        staged = Object.freeze([]);
        return current;
      } finally {
        committing = false;
      }
    },
  });
}

// Signs a commit over already validated entries and returns the extended history.
// The previous history is unchanged.
async function appendCommit(
  previous: LedgerHistory | null,
  signer: Signer,
  entries: readonly Entry[],
  metadata: JsonObject | undefined,
  maxBytesForGenesis = DEFAULT_MAX_BYTES,
): Promise<LedgerHistory> {
  const { records, size, maxBytes } = previous
    ? internals(previous)
    : { records: [], size: 0, maxBytes: maxBytesForGenesis };
  const body: Body = {
    parent: previous?.head ?? null,
    nonce: base64urlnopad.encode(crypto.getRandomValues(new Uint8Array(16))),
    entries: entries.map(({ id: _id, ...entry }) => entry),
    ...(metadata === undefined ? {} : { metadata }),
  };
  const proof = await createSealProof({
    signer,
    subject: { hash: await createSealHash(bodyBytes(body)) },
  });
  const record = canonical({ body, proof });
  const nextSize =
    (previous ? size + 1 : encoder.encode(ENVELOPE.join("")).length) +
    encoder.encode(record).length;
  if (nextSize > maxBytes) throw new RangeError(`Ledger would exceed ${maxBytes} bytes`);
  return new LedgerHistory(
    ISSUE,
    [...(previous?.commits ?? []), makeCommit(body, entries, proof)],
    [...records, record],
    nextSize,
    maxBytes,
  );
}

type StoredEntry = { nonce: string; kind: string; payload: Json; meta?: JsonObject };
type Body = {
  parent: `commit:${string}` | null;
  nonce: string;
  entries: StoredEntry[];
  metadata?: JsonObject;
};

function makeCommit(body: Body, entries: readonly Entry[], proof: SealProof): Commit {
  const id = `commit:${digest("ledger.commit-id/2", canonical(proof))}` as const;
  return deepFreeze({ id, ...body, entries: [...entries], proof });
}

function bodyBytes(body: Body): Uint8Array<ArrayBuffer> {
  return encoder.encode(`ledger.commit/2\0${canonical(body)}`);
}

function withId(entry: StoredEntry, parent: string | null, author: string): Entry {
  const id = `entry:${digest("ledger.entry-id/2", canonical({ author, entry, parent }))}` as const;
  return deepFreeze({ ...entry, id });
}

function digest(domain: string, value: string): string {
  return hex.encode(sha256(encoder.encode(`${domain}\0${value}`)));
}

// Validates and copies a batch before any of it is staged. Nonces must be unique
// within the commit, including against entries already staged.
function prepareEntries(
  inputs: readonly EntryInput[],
  parent: string | null,
  author: string,
  staged: readonly Entry[],
): Entry[] {
  if (!Array.isArray(inputs)) throw new TypeError("Entries must be an array");
  const nonces = new Set(staged.map((entry) => entry.nonce));
  return inputs.map((input) => {
    const { kind, payload, nonce, meta } = input;
    const entry = readEntry({
      nonce: nonce ?? base64urlnopad.encode(crypto.getRandomValues(new Uint8Array(16))),
      kind,
      payload: capture(payload),
      ...(meta === undefined ? {} : { meta: captureObject(meta) }),
    });
    if (nonces.has(entry.nonce)) throw new Error(`Duplicate entry nonce ${entry.nonce}`);
    nonces.add(entry.nonce);
    return withId(entry, parent, author);
  });
}

function readBody(value: unknown, parent: `commit:${string}` | null): Body {
  const keys = ["entries", "nonce", "parent"];
  if (!hasExactKeys(value, Object.hasOwn(value ?? {}, "metadata") ? [...keys, "metadata"] : keys)) {
    throw new Error("Commit body is malformed");
  }
  if (value.parent !== parent) throw new Error("Commit does not follow its parent");
  if (!isNonce(value.nonce) || !Array.isArray(value.entries)) {
    throw new Error("Commit body is malformed");
  }
  if (parent !== null && value.entries.length === 0) throw new Error("Commit has no entries");
  if (value.metadata !== undefined && !isObject(value.metadata)) {
    throw new Error("Commit metadata must be an object");
  }
  const nonces = new Set<string>();
  const entries = value.entries.map((entry) => {
    const read = readEntry(entry);
    if (nonces.has(read.nonce)) throw new Error(`Duplicate entry nonce ${read.nonce}`);
    nonces.add(read.nonce);
    return read;
  });
  return { ...(value as Body), entries };
}

function readEntry(value: unknown): StoredEntry {
  const keys = ["kind", "nonce", "payload"];
  if (!hasExactKeys(value, Object.hasOwn(value ?? {}, "meta") ? [...keys, "meta"] : keys)) {
    throw new Error("Entry is malformed");
  }
  const { kind, nonce, meta } = value;
  if (typeof kind !== "string" || kind.length < 1 || kind.length > 128) {
    throw new Error("Entry kind must be 1 to 128 characters");
  }
  if (!isNonce(nonce)) throw new Error("Entry nonce must be 16 bytes of base64url");
  if (meta !== undefined && !isObject(meta)) throw new Error("Entry meta must be an object");
  return value as StoredEntry;
}

function captureSigner(signer: Signer): Signer {
  const publicIdentity = validatePublicIdentity(signer.publicIdentity);
  const sign = signer.sign.bind(signer);
  return { publicIdentity, sign };
}

function capture(value: unknown): Json {
  return JSON.parse(canonical(value)) as Json;
}

function captureObject(value: unknown): JsonObject {
  const copy = capture(value);
  if (!isObject(copy)) throw new TypeError("Expected a JSON object");
  return copy;
}

function resolveMaxBytes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("maxBytes must be positive");
  return value;
}

// Canonical JSON: keys sorted by UTF-16 code units, no whitespace, safe integers only.
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError(`${value} is not a safe integer`);
    }
    return String(value);
  }
  if (typeof value === "string") return quote(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonical).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    const members = Object.keys(object)
      .sort()
      .map((key) => `${quote(key)}:${canonical(object[key])}`);
    return `{${members.join(",")}}`;
  }
  throw new TypeError("Ledger values must be plain JSON");
}

function quote(value: string): string {
  // In a /u regex a lone surrogate is one code point of category Cs; a valid pair is not.
  if (/\p{Cs}/u.test(value)) throw new TypeError("Strings must be well-formed Unicode");
  return JSON.stringify(value);
}

function hasExactKeys<K extends string>(value: unknown, keys: K[]): value is Record<K, unknown> {
  return (
    isObject(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonce(value: unknown): value is string {
  try {
    return typeof value === "string" && base64urlnopad.decode(value).length === 16;
  } catch {
    return false;
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
