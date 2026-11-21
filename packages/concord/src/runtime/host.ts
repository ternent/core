import { validatePublicIdentity } from "@ternent/identity";
import { fail } from "../common/errors.js";
import { detached } from "../common/immutable.js";
import { limits as configureLimits, ref } from "../protocol/schema.js";
import type { Json, DomainEvent } from "../protocol/types.js";
import type { HostOptions } from "../model/types.js";
import { same } from "./validation.js";

export type Options = HostOptions<Json, Record<string, Json>, DomainEvent> & { invalidHost?: true };

export function host(options: Options): void {
  if (options.invalidHost) fail("HOST_CONFIGURATION", "requirements");
  if (options.mode !== undefined && options.mode !== "immediate" && options.mode !== "draft")
    fail("HOST_CONFIGURATION", "requirements");
  if (options.model) {
    const model = options.model;
    try {
      ref(model.ref, "");
    } catch {
      fail("HOST_CONFIGURATION", "requirements");
    }
    if (
      !model.commands ||
      typeof model.commands !== "object" ||
      ![
        model.initial,
        model.validateEvent,
        model.requirements,
        model.reduce,
        ...Object.values(model.commands).flatMap((c) => [c?.validate, c?.decide]),
      ].every((fn) => typeof fn === "function") ||
      [
        model.audience,
        model.reduceLocked,
        ...Object.values(model.commands).map((c) => c?.audience),
      ].some((fn) => fn !== undefined && typeof fn !== "function")
    )
      fail("HOST_CONFIGURATION", "requirements");
  }
  if (options.system) {
    try {
      ref(options.system.ref, "");
    } catch {
      fail("HOST_CONFIGURATION", "requirements");
    }
    if (
      ![options.system.bootstrap, options.system.replay, options.system.prepare].every(
        (fn) => typeof fn === "function",
      )
    )
      fail("HOST_CONFIGURATION", "requirements");
  }
  for (const capability of [options.signer, options.reader])
    if (
      capability &&
      (!validatePublicIdentity(capability.publicIdentity).ok ||
        typeof capability.decryptAge !== "function")
    )
      fail("HOST_CONFIGURATION", "requirements");
  if (options.signer && typeof options.signer.sign !== "function")
    fail("HOST_CONFIGURATION", "requirements");
  if (
    options.signer &&
    options.reader &&
    !same(options.signer.publicIdentity, options.reader.publicIdentity)
  )
    fail("IDENTITY_MISMATCH", "requirements");
}
export function copyOptions(input: Options): Options {
  configureLimits(input.limits);
  const model = input.model;
  return {
    ...input,
    limits: input.limits ? { ...input.limits } : undefined,
    anchor: input.anchor ? new Uint8Array(input.anchor) : undefined,
    model: model
      ? {
          ...model,
          ref: detached(model.ref),
          commands: Object.fromEntries(
            Object.entries(model.commands ?? {}).map(([key, value]) => [key, { ...value }]),
          ),
        }
      : undefined,
    system: input.system ? { ...input.system, ref: detached(input.system.ref) } : undefined,
  };
}
