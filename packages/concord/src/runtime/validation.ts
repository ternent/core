import { error, fail, Fault, type Result, type ErrorCode } from "../common/errors.js";
import { freeze } from "../common/immutable.js";
import { encodeJson, parseJson, text } from "../protocol/json.js";
import type { Limits } from "../protocol/types.js";
import type { Capability, ModelIssue } from "../model/types.js";

export const same = (a: unknown, b: unknown) =>
  text.decode(encodeJson(a)) === text.decode(encodeJson(b));
export const capabilities: Capability[] = ["read", "write", "grant", "administer"];
export function checkRequirements(values: readonly Capability[]): void {
  if (
    !Array.isArray(values) ||
    new Set(values).size !== values.length ||
    !values.every((v) => capabilities.includes(v))
  )
    fail("MODEL_FAILED", "model");
}

export function accepted<T>(result: Result<T, ModelIssue>, code: ErrorCode): T {
  if (!result || typeof result !== "object" || typeof result.ok !== "boolean")
    fail("MODEL_FAILED", "model");
  if (!result.ok) {
    const outer =
      code === "EVENT_INVALID" && result.error.code === "EVENT_UNSUPPORTED"
        ? "EVENT_UNSUPPORTED"
        : code;
    const finding = error(
      outer,
      outer.startsWith("COMMAND") ? "author" : "model",
      result.error.path,
    );
    finding.details = { modelCode: result.error.code };
    throw new Fault(finding);
  }
  return result.value;
}
export function json<T>(
  value: T,
  lim: Limits,
  code: ErrorCode,
  phase: "model" | "author" | "system" = "model",
): T {
  try {
    return freeze(parseJson(encodeJson(value, lim.maxDepth), lim.maxDepth, lim.maxBytes)) as T;
  } catch (cause) {
    if (cause instanceof Fault && cause.finding.code === "RESOURCE_LIMIT") throw cause;
    fail(code, phase);
  }
}
