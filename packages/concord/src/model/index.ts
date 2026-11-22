import type { ApplicationModel } from "./types.js";
import type { Json, DomainEvent } from "../protocol/types.js";
export function defineModel<S extends Json, C extends Record<string, Json>, E extends DomainEvent>(
  model: ApplicationModel<S, C, E>,
): ApplicationModel<S, C, E> {
  return model;
}
