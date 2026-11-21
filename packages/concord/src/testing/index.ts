import { detached, freeze } from "../common/immutable.js";
import { defineModel } from "../model/index.js";
import { canonicalize, text, unicode, utf8 } from "../protocol/json.js";
import { object } from "../protocol/schema.js";
import { error, ok, type Result } from "../common/errors.js";
import type { ApplicationModel, ModelIssue, SystemFacts } from "../model/types.js";
import type { Json, DomainEvent } from "../protocol/types.js";
type RegisterState = { value: string };
type RegisterCommands = { set: { value: string } };
type RegisterEvent = { type: "value.set"; version: 1; data: { value: string } };
const issue = (code: string): { ok: false; error: ModelIssue } => ({
  ok: false,
  error: { code, message: code },
});
function value(input: unknown): Result<{ value: string }, ModelIssue> {
  if (
    !canonicalize(input).ok ||
    !object(input) ||
    Object.keys(input).length !== 1 ||
    typeof input.value !== "string" ||
    !unicode(input.value) ||
    utf8.encode(input.value).length > 4096
  )
    return issue("VALUE_INVALID");
  return { ok: true, value: { value: input.value } };
}
export const registerModel = defineModel<RegisterState, RegisterCommands, RegisterEvent>({
  ref: { id: "concord.example.register", version: 1 },
  initial: () => ({ value: "" }),
  commands: {
    set: {
      validate: value,
      decide: (input) => ({ ok: true, value: [{ type: "value.set", version: 1, data: input }] }),
    },
  },
  validateEvent(input) {
    if (!object(input) || Object.keys(input).length !== 3) return issue("EVENT_INVALID");
    if (input.type !== "value.set" || input.version !== 1) return issue("EVENT_UNSUPPORTED");
    const valid = value(input.data);
    return valid.ok
      ? { ok: true, value: { type: "value.set", version: 1, data: valid.value } }
      : issue("VALUE_INVALID");
  },
  requirements: () => ["write"],
  reduce: (_state, event) => ({ ok: true, value: { value: event.data.value } }),
});
export function assertModelConformance<
  S extends Json,
  C extends Record<string, Json>,
  E extends DomainEvent,
>(
  model: ApplicationModel<S, C, E>,
  cases: { initial: S; steps: readonly { event: E; facts: SystemFacts; expected: S }[] },
): Result<{ passed: number }> {
  const canonical = (input: unknown) => {
    const encoded = canonicalize(input);
    if (!encoded.ok) throw new Error("invalid");
    return text.decode(encoded.value);
  };
  try {
    const fixed = detached(cases);
    for (let pass = 0; pass < 2; pass++) {
      let state = detached(model.initial());
      if (canonical(state) !== canonical(fixed.initial))
        return { ok: false, error: error("MODEL_TRANSITION_INVALID", "model") };
      for (const step of fixed.steps) {
        const event = model.validateEvent(step.event);
        if (!event.ok) return { ok: false, error: error("EVENT_INVALID", "model") };
        const next = model.reduce(state, freeze(event.value), step.facts);
        if (!next.ok || canonical(next.value) !== canonical(step.expected))
          return { ok: false, error: error("MODEL_TRANSITION_INVALID", "model") };
        state = detached(next.value);
      }
    }
    return ok({ passed: cases.steps.length + 1 });
  } catch {
    return { ok: false, error: error("MODEL_FAILED", "model") };
  }
}
export { createMemoryArtifactStore, createMemoryExpectedHeadStore } from "./artifact-store.js";
export type { ArtifactStore, ExpectedHeadArtifactStore, StorageError } from "./artifact-store.js";
