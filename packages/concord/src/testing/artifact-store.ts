import type { Result } from "../common/errors.js";
import { defaults } from "../protocol/schema.js";
import { verifyDocument } from "../protocol/verify.js";
import type { CommitId } from "../protocol/types.js";

export type StorageError =
  | { code: "STORAGE_FAILED"; phase: "storage"; message: string }
  | { code: "HEAD_CONFLICT"; phase: "storage"; message: string; remote: Uint8Array | null };
export type ArtifactStore = {
  read(): Promise<Result<Uint8Array | null, StorageError>>;
  write(bytes: Uint8Array): Promise<Result<void, StorageError>>;
};
export type ExpectedHeadArtifactStore = ArtifactStore & {
  readonly expectedHead: true;
  writeExpected(bytes: Uint8Array, expected: CommitId | null): Promise<Result<void, StorageError>>;
};
const failed = (): { ok: false; error: StorageError } => ({
  ok: false,
  error: { code: "STORAGE_FAILED", phase: "storage", message: "Artifact storage operation failed" },
});
function capture(bytes: Uint8Array, maxBytes?: number): Result<Uint8Array, StorageError> {
  try {
    return bytes instanceof Uint8Array && (maxBytes === undefined || bytes.byteLength <= maxBytes)
      ? { ok: true, value: new Uint8Array(bytes) }
      : failed();
  } catch {
    return failed();
  }
}

export function createMemoryArtifactStore(): ArtifactStore {
  let stored: Uint8Array | null = null;
  return {
    async read() {
      return { ok: true, value: stored === null ? null : new Uint8Array(stored) };
    },
    async write(bytes) {
      const copied = capture(bytes);
      if (!copied.ok) return copied;
      stored = copied.value;
      return { ok: true, value: undefined };
    },
  };
}

/** Reference atomicity is limited to writers sharing this in-memory instance. */
export function createMemoryExpectedHeadStore(): ExpectedHeadArtifactStore {
  let stored: Uint8Array | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const mutate = (
    body: () => Result<void, StorageError> | Promise<Result<void, StorageError>>,
  ): Promise<Result<void, StorageError>> => {
    const result = queue.then(body).catch(failed);
    queue = result.then(() => undefined);
    return result;
  };
  return Object.freeze({
    expectedHead: true as const,
    async read() {
      return { ok: true as const, value: stored === null ? null : new Uint8Array(stored) };
    },
    write(bytes: Uint8Array) {
      const copied = capture(bytes);
      return mutate(() => {
        if (!copied.ok) return copied;
        stored = copied.value;
        return { ok: true, value: undefined };
      });
    },
    writeExpected(bytes: Uint8Array, expected: CommitId | null) {
      const copied = capture(bytes, defaults.maxBytes);
      return mutate(async () => {
        if (!copied.ok) return copied;
        if (
          expected !== null &&
          (typeof expected !== "string" || !/^commit:[0-9a-f]{64}$/.test(expected))
        )
          return failed();
        // Validation and comparison share the mutation queue, including unconditional writes.
        const candidate = await verifyDocument(copied.value);
        if (candidate.integrity !== "valid") return failed();
        let head: CommitId | null = null;
        if (stored !== null) {
          const current = await verifyDocument(stored);
          if (current.integrity !== "valid") return failed();
          head = current.head;
        }
        if (head !== expected)
          return {
            ok: false,
            error: {
              code: "HEAD_CONFLICT",
              phase: "storage",
              message: "Stored head differs from expected head",
              remote: stored === null ? null : new Uint8Array(stored),
            },
          };
        stored = copied.value;
        return { ok: true, value: undefined };
      });
    },
  });
}
