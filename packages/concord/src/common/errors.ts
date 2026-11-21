import {
  Fault,
  ok as historyOk,
  error as historyError,
  fail as historyFail,
  caught as historyCaught,
  attempt as historyAttempt,
} from "@ternent/ledger/protocol";
export { Fault };
import type { JsonObject } from "../protocol/types.js";
export type ErrorCode =
  | "JSON_INVALID"
  | "SCHEMA_INVALID"
  | "PROTOCOL_UNSUPPORTED"
  | "SUITE_UNSUPPORTED"
  | "ENTRY_KIND_UNSUPPORTED"
  | "RESOURCE_LIMIT"
  | "DUPLICATE_RECORD"
  | "UNREFERENCED_RECORD"
  | "ENTRY_MISSING"
  | "ENTRY_ORDER"
  | "HASH_MISMATCH"
  | "LINK_INVALID"
  | "DECLARATION_INVALID"
  | "HEAD_INVALID"
  | "IDENTITY_INVALID"
  | "SIGNATURE_INVALID"
  | "REQUIREMENT_UNAVAILABLE"
  | "HOST_CONFIGURATION"
  | "IDENTITY_MISMATCH"
  | "STALE_HEAD"
  | "DIVERGED_HEAD"
  | "DOCUMENT_MISMATCH"
  | "ANCHOR_INVALID"
  | "SYSTEM_EVENT_INVALID"
  | "SYSTEM_NO_CHANGE"
  | "LAST_ADMINISTRATOR"
  | "UNSUPPORTED_SYSTEM_EVENT"
  | "CAPABILITY_DENIED"
  | "READ_ACCESS_REQUIRED"
  | "KEY_UNAVAILABLE"
  | "KEY_WRAP_INVALID"
  | "DECRYPTION_INVALID"
  | "EVENT_CONTEXT_INVALID"
  | "HISTORICAL_KEY_UNAVAILABLE"
  | "COMMAND_UNSUPPORTED"
  | "COMMAND_INVALID"
  | "COMMAND_REJECTED"
  | "NO_EVENTS"
  | "EVENT_UNSUPPORTED"
  | "EVENT_INVALID"
  | "MODEL_TRANSITION_INVALID"
  | "MODEL_FAILED"
  | "SYSTEM_FAILED"
  | "READ_ONLY_RUNTIME"
  | "INSPECTION_ONLY"
  | "NO_DRAFT"
  | "DRAFT_PENDING"
  | "SIGNING_FAILED"
  | "ENCRYPTION_FAILED"
  | "STORAGE_FAILED"
  | "HEAD_CONFLICT";
export type Phase =
  | "input"
  | "protocol"
  | "requirements"
  | "system"
  | "model"
  | "author"
  | "storage";
export type ConcordError = {
  code: ErrorCode;
  phase: Phase;
  message: string;
  path?: string;
  commitId?: string;
  entryId?: string;
  details?: Readonly<JsonObject>;
};
export type Result<T, E = ConcordError> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T> => historyOk(value) as Result<T>;
export const error = (code: ErrorCode, phase: Phase, path?: string): ConcordError =>
  historyError(code, phase, path) as ConcordError;
export function fail(code: ErrorCode, phase: Phase = "protocol", path?: string): never {
  return historyFail(code, phase, path);
}
export function caught(cause: unknown, fallback: ErrorCode, phase: Phase): ConcordError {
  return historyCaught(cause, fallback, phase) as ConcordError;
}
export function attempt<T>(
  body: () => T,
  fallback: ErrorCode = "SCHEMA_INVALID",
  phase: Phase = "protocol",
): Result<T> {
  return historyAttempt(body, fallback, phase) as Result<T>;
}
