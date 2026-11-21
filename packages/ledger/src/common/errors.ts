import type { JsonObject } from "../protocol/types.js";

export type HistoryError = {
  code: string;
  phase: string;
  message: string;
  path?: string;
  commitId?: string;
  entryId?: string;
  details?: Readonly<JsonObject>;
};
export type Result<T, E = HistoryError> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const error = (code: string, phase: string, path?: string): HistoryError => ({
  code,
  phase,
  message: code.replaceAll("_", " ").toLowerCase(),
  ...(path === undefined ? {} : { path }),
});
export class Fault extends Error {
  constructor(readonly finding: HistoryError) {
    super(finding.code);
  }
}
export function fail(code: string, phase = "protocol", path?: string): never {
  throw new Fault(error(code, phase, path));
}
export function caught(cause: unknown, fallback: string, phase: string): HistoryError {
  return cause instanceof Fault ? cause.finding : error(fallback, phase);
}
export function attempt<T>(
  body: () => T,
  fallback = "SCHEMA_INVALID",
  phase = "protocol",
): Result<T> {
  try {
    return ok(body());
  } catch (cause) {
    return { ok: false, error: caught(cause, fallback, phase) };
  }
}
