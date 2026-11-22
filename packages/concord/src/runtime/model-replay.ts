import { fail } from "../common/errors.js";
import { isAudienceId } from "../protocol/schema.js";
import type { Json, DomainEvent, Limits } from "../protocol/types.js";
import type { ApplicationModel } from "../model/types.js";
import type { SystemReplay } from "../system/types.js";
import { accepted, checkRequirements, json } from "./validation.js";

type AnyModel = ApplicationModel<Json, Record<string, Json>, DomainEvent>;

export function fold(
  model: AnyModel,
  system: SystemReplay,
  lim: Limits,
  call: <T>(fn: () => T) => T,
): Json {
  let projection = json(
    call(() => model.initial()),
    lim,
    "MODEL_TRANSITION_INVALID",
  );
  for (const item of system.entries) {
    if (item.status === "locked") {
      if (!model.reduceLocked) fail("KEY_UNAVAILABLE", "system");
      projection = json(
        accepted(
          call(() =>
            model.reduceLocked!(
              projection,
              { audience: item.audience, epoch: item.epoch },
              item.facts,
            ),
          ),
          "MODEL_TRANSITION_INVALID",
        ),
        lim,
        "MODEL_TRANSITION_INVALID",
      );
      continue;
    }
    const event = json(
      accepted(
        call(() => model.validateEvent(item.event)),
        "EVENT_INVALID",
      ),
      lim,
      "EVENT_INVALID",
    );
    const audience = call(() => (model.audience ? model.audience(event) : "document"));
    if (!isAudienceId(audience) || audience !== item.facts.audience) fail("EVENT_INVALID", "model");
    const required = call(() => model.requirements(event));
    checkRequirements(required);
    if (
      !item.facts.capabilities.includes("write") ||
      !required.every((c) => item.facts.capabilities.includes(c))
    )
      fail("CAPABILITY_DENIED", "system");
    projection = json(
      accepted(
        call(() => model.reduce(projection, event, item.facts)),
        "MODEL_TRANSITION_INVALID",
      ),
      lim,
      "MODEL_TRANSITION_INVALID",
    );
  }
  return projection;
}
