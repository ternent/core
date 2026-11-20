import { expect, test, vi } from "vite-plus/test";
import {
  identityFromSeed,
  generateIdentity,
  encryptAge,
  type IdentityCapability,
} from "@ternent/armour";
import { createDocument, openDocument, type Snapshot, type Json } from "../src/index.js";
import { createStandardSystemProfile } from "../src/system/index.js";
import {
  registerModel,
  assertModelConformance,
  createMemoryArtifactStore,
} from "../src/testing/index.js";
import { verifyDocument } from "../src/protocol/index.js";
import { vector, seed, encoded, base64, decoded, resign } from "./fixtures.js";
const value = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};
const owner = async () => value(await identityFromSeed(seed));
const model = registerModel;
const bytes = () => encoded(vector<Snapshot>("owner.document"));
const open = async (
  extra: {
    bytes?: Uint8Array;
    anchor?: Uint8Array;
    signer?: IdentityCapability;
    reader?: import("@ternent/armour").ReaderCapability;
    model?: typeof model;
  } = {},
) =>
  openDocument({
    bytes: bytes(),
    model,
    system: createStandardSystemProfile(),
    signer: await owner(),
    ...extra,
  });
test("R01-R05 immediate create, dispatch, export, reopen, independent verify and saved replay", async () => {
  const identity = await owner(),
    system = createStandardSystemProfile();
  const created = value(await createDocument({ model, system, identity }));
  expect(created.state()).toMatchObject({
    status: "ready",
    projection: { value: "" },
    canWrite: true,
  });
  expect(JSON.parse(new TextDecoder().decode(created.export())).commits).toHaveLength(1);
  const receipt = value(await created.dispatch("set", { value: "hello Concord" }));
  expect(receipt.status).toBe("committed");
  expect(created.state()).toMatchObject({ projection: { value: "hello Concord" } });
  const saved = created.export(),
    wire = JSON.parse(new TextDecoder().decode(saved)) as Snapshot;
  expect(wire.commits).toHaveLength(2);
  expect(wire.entries).toHaveLength(2);
  expect(new TextDecoder().decode(saved)).not.toContain("hello Concord");
  expect(Object.keys(wire).sort()).toEqual([
    "commits",
    "documentId",
    "entries",
    "format",
    "head",
    "metadata",
    "version",
  ]);
  const reopened = await openDocument({ bytes: saved, model, system, signer: identity });
  expect(reopened.state()).toEqual(created.state());
  expect(await reopened.verify()).toMatchObject({ integrity: "valid" });
  expect(await verifyDocument(saved)).toMatchObject({ integrity: "valid" });
  expect(value(await reopened.replay())).toEqual({ value: "hello Concord" });
  expect(await reopened.replay()).toEqual(await reopened.replay());
  expect(reopened.inspect()).toMatchObject({
    system: "valid",
    application: "valid",
    freshness: "unanchored",
    findings: [],
    lockedEntries: 0,
  });
});
test("R06 fixed independent owner artifact reconstructs its literal projection and IDs", async () => {
  const expected = vector<{ projection: Json; documentId: string; head: string }>("owner.expected"),
    handle = await open();
  expect(handle.state()).toEqual({
    status: "ready",
    projection: expected.projection,
    documentId: expected.documentId,
    head: expected.head,
    canWrite: true,
  });
});
test("R07/R20 no reader and unrelated reader stay locked, including a private genesis", async () => {
  for (const [input, count] of [
    [bytes(), 1],
    [encoded(vector("owner.genesis.document")), 0],
  ] as const) {
    const locked = await openDocument({
      bytes: input,
      model,
      system: createStandardSystemProfile(),
    });
    expect(locked.state()).toEqual({ status: "inspection", reason: "locked" });
    expect(locked.inspect()).toMatchObject({
      application: "locked",
      lockedEntries: count,
      findings: [{ code: "READ_ACCESS_REQUIRED" }],
    });
    expect(locked.export()).toEqual(input);
    expect(await locked.dispatch("set", { value: "bad" })).toMatchObject({
      ok: false,
      error: { code: "INSPECTION_ONLY" },
    });
  }
  const unrelated = value(await generateIdentity());
  expect((await open({ signer: unrelated })).state()).toMatchObject({
    status: "inspection",
    reason: "locked",
  });
});
test("R08 decrypt-only capability is ready but all mutations are read-only", async () => {
  const identity = await owner(),
    handle = await openDocument({
      bytes: bytes(),
      model,
      system: createStandardSystemProfile(),
      reader: { publicIdentity: identity.publicIdentity, decryptAge: identity.decryptAge },
    });
  expect(handle.state()).toMatchObject({
    status: "ready",
    canWrite: false,
    projection: { value: "hello Concord" },
  });
  for (const result of [
    await handle.dispatch("set", { value: "bad" }),
    await handle.commit(),
    await handle.discardDraft(),
  ])
    expect(result).toMatchObject({ ok: false, error: { code: "READ_ONLY_RUNTIME" } });
});
test("R09/R18 tampering never invokes models; malformed evidence remains byte-exact", async () => {
  const initial = vi.fn(model.initial),
    spy = { ...model, initial };
  for (const input of [
    new TextEncoder().encode("{broken"),
    (() => {
      const wire = vector<Snapshot>("owner.document");
      wire.commits[1].subject.metadata = { message: "tamper" };
      return encoded(wire);
    })(),
  ]) {
    const handle = await openDocument({
      bytes: input,
      model: spy,
      system: createStandardSystemProfile(),
      signer: await owner(),
    });
    expect(handle.state()).toEqual({ status: "inspection", reason: "invalid" });
    expect(handle.export()).toEqual(input);
    expect((await handle.verify()).integrity).toBe("invalid");
    expect(await handle.replay()).toMatchObject({ ok: false });
  }
  expect(initial).not.toHaveBeenCalled();
});
test("R10/P18 exact requirements, host configuration and reader/signer identity", async () => {
  const unavailable = await openDocument({ bytes: bytes() });
  expect(unavailable.inspect().requirements).toEqual([
    { kind: "system", ref: { id: "concord.standard", version: 1 } },
    { kind: "model", ref: model.ref },
  ]);
  expect(unavailable.state()).toMatchObject({ reason: "incompatible" });
  expect((await unavailable.verify()).integrity).toBe("valid");
  const other = value(await generateIdentity());
  expect((await open({ reader: other })).inspect().findings[0].code).toBe("IDENTITY_MISMATCH");
  expect(
    (await open({ model: { ...model, ref: { ...model.ref, version: 2 } } })).inspect().findings[0]
      .code,
  ).toBe("REQUIREMENT_UNAVAILABLE");
  expect(
    await createDocument({
      model,
      system: createStandardSystemProfile(),
      identity: await owner(),
      limits: { maxBytes: 0 },
    }),
  ).toMatchObject({ ok: false, error: { code: "HOST_CONFIGURATION" } });
});
test("R11-R13 integrity-valid private events still require authentication, exact context and model meaning", async () => {
  const expected = vector<{
    groupRecipient: string;
    eventPlaintext: {
      context: string;
      parent: string;
      nonce: string;
      model: { id: string; version: number };
      audience: string;
      epoch: number;
      event: { type: string; version: number; data: Json };
    };
  }>("owner.expected");
  for (const [edit, code] of [
    [
      (body: typeof expected.eventPlaintext) => {
        body.nonce = base64(new Uint8Array(16).fill(42));
      },
      "EVENT_CONTEXT_INVALID",
    ],
    [
      (body: typeof expected.eventPlaintext) => {
        body.parent = `commit:${"0".repeat(64)}`;
      },
      "EVENT_CONTEXT_INVALID",
    ],
    [
      (body: typeof expected.eventPlaintext) => {
        body.model.version = 2;
      },
      "EVENT_CONTEXT_INVALID",
    ],
    [
      (body: typeof expected.eventPlaintext) => {
        body.epoch = 1;
      },
      "EVENT_CONTEXT_INVALID",
    ],
    [
      (body: typeof expected.eventPlaintext) => {
        body.event.type = "value.future";
      },
      "EVENT_UNSUPPORTED",
    ],
    [
      (body: typeof expected.eventPlaintext) => {
        body.event.data = { value: 12 };
      },
      "EVENT_INVALID",
    ],
  ] as const) {
    const wire = vector<Snapshot>("owner.document"),
      body = structuredClone(expected.eventPlaintext);
    edit(body);
    if (wire.entries[1].subject.kind !== "application") throw new Error("fixture");
    wire.entries[1].subject.payload.ciphertext = base64(
      value(await encryptAge({ recipients: [expected.groupRecipient], plaintext: encoded(body) })),
    );
    resign(wire);
    expect((await verifyDocument(encoded(wire))).integrity).toBe("valid");
    const handle = await open({ bytes: encoded(wire) });
    expect(handle.state().status).toBe("inspection");
    expect(handle.inspect().findings[0].code).toBe(code);
  }
  const wire = vector<Snapshot>("owner.document");
  if (wire.entries[1].subject.kind !== "application") throw new Error("fixture");
  const ciphertext = decoded(wire.entries[1].subject.payload.ciphertext);
  ciphertext[ciphertext.length - 1] ^= 1;
  wire.entries[1].subject.payload.ciphertext = base64(ciphertext);
  resign(wire);
  expect((await open({ bytes: encoded(wire) })).inspect().findings[0].code).toBe(
    "DECRYPTION_INVALID",
  );
});
test("R13 reducers reject and throw without leaking messages or partial projection", async () => {
  for (const [reduce, code] of [
    [
      () => ({ ok: false as const, error: { code: "DOMAIN_REJECTED", message: "private" } }),
      "MODEL_TRANSITION_INVALID",
    ],
    [
      () => {
        throw new Error("private plaintext");
      },
      "MODEL_FAILED",
    ],
    [() => ({ ok: true as const, value: { value: NaN } }), "MODEL_TRANSITION_INVALID"],
  ] as const) {
    const handle = await openDocument({
      bytes: bytes(),
      model: { ...model, reduce } as unknown as typeof model,
      system: createStandardSystemProfile(),
      signer: await owner(),
    });
    expect(handle.inspect().findings[0].code).toBe(code);
    expect(JSON.stringify(handle.inspect())).not.toContain("private");
    expect(handle.state().status).toBe("inspection");
  }
});
test("R14 author failures preserve export; equal commands still commit", async () => {
  const handle = await open(),
    before = handle.export();
  // @ts-expect-error Unknown commands remain rejected for JS callers too.
  expect(await handle.dispatch("missing", {})).toMatchObject({
    ok: false,
    error: { code: "COMMAND_UNSUPPORTED" },
  });
  for (const data of [
    { value: 1 },
    { value: "a", extra: true },
    { value: "\ud800" },
    { value: "x".repeat(4097) },
  ]) {
    // @ts-expect-error Runtime validation remains necessary for JS callers.
    expect(await handle.dispatch("set", data)).toMatchObject({
      ok: false,
      error: { code: "COMMAND_INVALID" },
    });
  }
  expect(handle.export()).toEqual(before);
  value(await handle.dispatch("set", { value: "hello Concord" }));
  expect(handle.export()).not.toEqual(before);
  for (const [decide, code] of [
    [() => ({ ok: false as const, error: { code: "NO", message: "private" } }), "COMMAND_REJECTED"],
    [() => ({ ok: true as const, value: [] }), "NO_EVENTS"],
  ] as const) {
    const altered = await openDocument({
      bytes: bytes(),
      model: { ...model, commands: { set: { ...model.commands.set, decide } } },
      system: createStandardSystemProfile(),
      signer: await owner(),
    });
    expect(await altered.dispatch("set", { value: "a" })).toMatchObject({
      ok: false,
      error: { code },
    });
    expect(altered.export()).toEqual(bytes());
  }
});
test("R15 signing, preparation and candidate replay failures are atomic", async () => {
  const identity = await owner(),
    system = createStandardSystemProfile();
  const failures = [
    {
      identity: {
        ...identity,
        async sign() {
          return { ok: false as const, error: { code: "FAILED", message: "private" } };
        },
      },
      system,
      code: "SIGNING_FAILED",
    },
    {
      identity,
      system: {
        ...system,
        async prepare() {
          throw new Error("private key");
        },
      },
      code: "SYSTEM_FAILED",
    },
  ];
  for (const input of failures) {
    const handle = await openDocument({
      bytes: bytes(),
      model,
      system: input.system,
      signer: input.identity,
    });
    const before = handle.export(),
      state = handle.state();
    expect(await handle.dispatch("set", { value: "a" })).toMatchObject({
      ok: false,
      error: { code: input.code },
    });
    expect(handle.export()).toEqual(before);
    expect(handle.state()).toEqual(state);
    expect(handle.draft()).toBeNull();
  }
  let failReplay = false;
  const profile = {
    ...system,
    async replay(input: Parameters<typeof system.replay>[0]) {
      if (failReplay) throw new Error("private");
      return system.replay(input);
    },
  };
  const handle = await openDocument({ bytes: bytes(), model, system: profile, signer: identity });
  failReplay = true;
  expect(await handle.dispatch("set", { value: "a" })).toMatchObject({
    ok: false,
    error: { code: "SYSTEM_FAILED" },
  });
  expect(handle.export()).toEqual(bytes());
});
test("R16 operations serialize and pending encryption does not publish intermediate state", async () => {
  const system = createStandardSystemProfile();
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>((resolve) => {
      release = resolve;
    }),
    entered = new Promise<void>((resolve) => {
      started = resolve;
    });
  let first = true;
  const profile = {
    ...system,
    async prepare(input: Parameters<typeof system.prepare>[0]) {
      if (first) {
        first = false;
        started();
        await waiting;
      }
      return system.prepare(input);
    },
  };
  const handle = await openDocument({
      bytes: bytes(),
      model,
      system: profile,
      signer: await owner(),
    }),
    before = handle.state();
  const a = handle.dispatch("set", { value: "first" });
  await entered;
  const b = handle.dispatch("set", { value: "second" });
  expect(handle.state()).toEqual(before);
  release();
  value(await a);
  value(await b);
  expect(handle.state()).toMatchObject({ projection: { value: "second" } });
  const wire = JSON.parse(new TextDecoder().decode(handle.export())) as Snapshot;
  expect(wire.commits[3].subject.parent).toBe(wire.commits[2].id);
});
test("R17 all public values detach; authoring rejects accessors before invoking them", async () => {
  const input = bytes(),
    handle = await open({ bytes: input });
  input.fill(0);
  const before = handle.export(),
    copy = handle.export();
  copy.fill(0);
  const state = handle.state();
  if (state.status === "ready")
    expect(() => Object.assign(state.projection, { value: "bad" })).toThrow();
  const report = handle.inspect();
  expect(() => Object.assign(report.history[0].subject, { nonce: "bad" })).toThrow();
  expect(handle.export()).toEqual(before);
  let invoked = false;
  const data = Object.defineProperty({}, "value", {
    get() {
      invoked = true;
      return "bad";
    },
    enumerable: true,
  });
  expect(await handle.dispatch("set", data as { value: string })).toMatchObject({
    ok: false,
    error: { code: "COMMAND_INVALID" },
  });
  expect(invoked).toBe(false);
});
test("R19 malformed bootstrap owner/wrap and unknown system events remain inspectable", async () => {
  for (const [edit, code] of [
    [
      (wire: Snapshot) => {
        if (wire.entries[0].subject.kind !== "system") throw new Error();
        wire.entries[0].subject.payload.data.wraps = [];
      },
      "SYSTEM_EVENT_INVALID",
    ],
    [
      (wire: Snapshot) => {
        if (wire.entries[0].subject.kind !== "system") throw new Error();
        (wire.entries[0].subject.payload.data.wraps as { ciphertext: string }[])[0].ciphertext =
          "AA";
      },
      "KEY_WRAP_INVALID",
    ],
    [
      (wire: Snapshot) => {
        if (wire.entries[0].subject.kind !== "system") throw new Error();
        wire.entries[0].subject.payload.type = "system.member.future";
      },
      "UNSUPPORTED_SYSTEM_EVENT",
    ],
  ] as const) {
    const wire = vector<Snapshot>("owner.genesis.document");
    edit(wire);
    resign(wire);
    expect((await verifyDocument(encoded(wire))).integrity).toBe("valid");
    const handle = await open({ bytes: encoded(wire) });
    expect(handle.inspect().findings[0].code).toBe(code);
    expect(handle.state().status).toBe("inspection");
  }
});
test("C06-C10 anchors gate replay while integrity remains valid", async () => {
  const genesis = encoded(vector("owner.genesis.document")),
    child = bytes(),
    fork = encoded(vector("owner.fork.document"));
  expect((await open({ anchor: genesis })).inspect().freshness).toBe("ahead");
  expect((await open({ anchor: child })).inspect().freshness).toBe("equal");
  for (const [input, anchor, code] of [
    [genesis, child, "STALE_HEAD"],
    [fork, child, "DIVERGED_HEAD"],
    [child, new Uint8Array(), "ANCHOR_INVALID"],
  ] as const) {
    const handle = await open({ bytes: input, anchor });
    expect(handle.state()).toMatchObject({ reason: "freshness" });
    expect(handle.inspect().findings[0].code).toBe(code);
    expect((await handle.verify()).integrity).toBe("valid");
  }
});
test("testing helpers assert literal model transitions and copy stored bytes", async () => {
  const identity = await owner();
  expect(
    assertModelConformance(model, {
      initial: { value: "" },
      steps: [
        {
          event: { type: "value.set", version: 1, data: { value: "literal" } },
          facts: { actor: identity.publicIdentity, capabilities: ["read", "write"], members: [] },
          expected: { value: "literal" },
        },
      ],
    }),
  ).toEqual({ ok: true, value: { passed: 2 } });
  const store = createMemoryArtifactStore(),
    input = bytes();
  value(await store.write(input));
  input.fill(0);
  const read = value(await store.read())!;
  expect(read).toEqual(bytes());
  read.fill(0);
  expect(value(await store.read())).toEqual(bytes());
});

test("author resource limits are checked before signing, and multi-event decisions form one commit", async () => {
  const identity = await owner(),
    sign = vi.fn(identity.sign);
  expect(
    await createDocument({
      model,
      system: createStandardSystemProfile(),
      identity: { ...identity, sign },
      limits: { maxBytes: 100 },
    }),
  ).toMatchObject({ ok: false, error: { code: "RESOURCE_LIMIT" } });
  expect(sign).not.toHaveBeenCalled();
  const multi = {
    ...model,
    commands: {
      set: {
        ...model.commands.set,
        decide: (input: { value: string }) => ({
          ok: true as const,
          value: [
            { type: "value.set" as const, version: 1 as const, data: { value: "first" } },
            { type: "value.set" as const, version: 1 as const, data: input },
          ],
        }),
      },
    },
  };
  const handle = value(
    await createDocument({ model: multi, system: createStandardSystemProfile(), identity }),
  );
  value(await handle.dispatch("set", { value: "last" }));
  const wire = JSON.parse(new TextDecoder().decode(handle.export())) as Snapshot;
  expect(wire.commits).toHaveLength(2);
  expect(wire.commits[1].subject.entryIds).toHaveLength(2);
  expect(handle.state()).toMatchObject({ projection: { value: "last" } });
});

test("synchronous model reentry is rejected without queue deadlock", async () => {
  let nested: Promise<unknown> | undefined;
  let handle: Awaited<ReturnType<typeof open>>;
  const reentrant = {
    ...model,
    commands: {
      set: {
        ...model.commands.set,
        decide: (input: { value: string }) => {
          nested = handle.dispatch("set", { value: "nested" });
          return {
            ok: true as const,
            value: [{ type: "value.set" as const, version: 1 as const, data: input }],
          };
        },
      },
    },
  };
  handle = await open({ model: reentrant });
  value(await handle.dispatch("set", { value: "outer" }));
  expect(await nested).toMatchObject({ ok: false, error: { code: "HOST_CONFIGURATION" } });
  expect(handle.state()).toMatchObject({ projection: { value: "outer" } });
});

test("profile output cannot omit events or rebind actors", async () => {
  const system = createStandardSystemProfile(),
    identity = await owner();
  for (const mode of ["missing", "actor"]) {
    const profile = {
      ...system,
      async replay(input: Parameters<typeof system.replay>[0]) {
        const result = await system.replay(input);
        if (!result.ok) return result;
        const value = result.value;
        return {
          ok: true as const,
          value: {
            ...value,
            events: mode === "missing" ? [] : value.events,
            entryFacts:
              mode === "actor"
                ? value.entryFacts.map((item) => ({
                    ...item,
                    facts: {
                      ...item.facts,
                      actor: { ...item.facts.actor, id: `identity:${"0".repeat(64)}` },
                    },
                  }))
                : value.entryFacts,
          },
        };
      },
    };
    expect(
      (await openDocument({ bytes: bytes(), model, system: profile, signer: identity })).inspect()
        .findings[0].code,
    ).toBe("SYSTEM_FAILED");
  }
});

test("model capabilities remain mandatory during authoring and historical replay", async () => {
  const extra = {
    ...model,
    requirements: () => ["write", "imaginary"] as unknown as ("read" | "write")[],
  };
  const result = await openDocument({
    bytes: bytes(),
    model: extra,
    system: createStandardSystemProfile(),
    signer: await owner(),
  });
  expect(result.inspect().findings[0].code).toBe("MODEL_FAILED");
});

test("first-slice authoring rejects deferred draft mode and alternative profile declarations", async () => {
  const identity = await owner(),
    system = createStandardSystemProfile();
  expect(await createDocument({ model, system, identity, mode: "draft" })).toMatchObject({
    ok: false,
    error: { code: "HOST_CONFIGURATION" },
  });
  expect(
    await createDocument({
      model,
      system: { ...system, ref: { id: "custom.system", version: 1 } },
      identity,
    }),
  ).toMatchObject({ ok: false, error: { code: "HOST_CONFIGURATION" } });
  expect(
    (
      await open({ anchor: value(await createDocument({ model, system, identity })).export() })
    ).inspect().findings[0].code,
  ).toBe("DOCUMENT_MISMATCH");
});

test("canonical export must fit the byte budget before any extension runs", async () => {
  const wire = vector<Snapshot>("owner.document");
  wire.metadata = { n: 1000000000000000 };
  const canonical = encoded(wire),
    transport = new TextEncoder().encode(
      new TextDecoder().decode(canonical).replace("1000000000000000", "1e15"),
    ),
    initial = vi.fn(model.initial),
    system = createStandardSystemProfile(),
    replay = vi.fn(system.replay),
    identity = await owner();
  expect(transport.length).toBeLessThan(canonical.length);
  const rejected = await openDocument({
    bytes: transport,
    model: { ...model, initial },
    system: { ...system, replay },
    signer: identity,
    limits: { maxBytes: transport.length },
  });
  expect(rejected.state()).toEqual({ status: "inspection", reason: "incompatible" });
  expect(await rejected.verify()).toMatchObject({
    integrity: "unsupported",
    findings: [{ code: "RESOURCE_LIMIT" }],
  });
  expect(rejected.export()).toEqual(transport);
  expect(await rejected.dispatch("set", { value: "blocked" })).toMatchObject({
    ok: false,
    error: { code: "INSPECTION_ONLY" },
  });
  expect(initial).not.toHaveBeenCalled();
  expect(replay).not.toHaveBeenCalled();
  const accepted = await openDocument({
    bytes: transport,
    model,
    system,
    signer: identity,
    limits: { maxBytes: canonical.length },
  });
  expect(accepted.state()).toMatchObject({
    status: "ready",
    projection: { value: "hello Concord" },
  });
  expect(accepted.export()).toEqual(canonical);
  expect((await accepted.verify()).integrity).toBe("valid");
  expect(value(await accepted.replay())).toEqual({ value: "hello Concord" });
});

test("a multi-event snapshot reopens at its exact wire budget despite expanded replay facts", async () => {
  const identity = await owner(),
    multi = {
      ...model,
      commands: {
        set: {
          ...model.commands.set,
          decide: () => ({
            ok: true as const,
            value: Array.from({ length: 20 }, () => ({
              type: "value.set" as const,
              version: 1 as const,
              data: { value: "" },
            })),
          }),
        },
      },
    },
    created = value(
      await createDocument({ model: multi, system: createStandardSystemProfile(), identity }),
    );
  value(await created.dispatch("set", { value: "" }));
  const saved = created.export(),
    limits = { maxBytes: saved.length };
  expect((await verifyDocument(saved, { limits })).integrity).toBe("valid");
  const reopened = await openDocument({
    bytes: saved,
    model: multi,
    system: createStandardSystemProfile(),
    signer: identity,
    limits,
  });
  expect(reopened.state()).toEqual(created.state());
  expect(reopened.export()).toEqual(saved);
  expect(reopened.inspect().findings).toEqual([]);
  expect(value(await reopened.replay())).toEqual({ value: "" });
  expect(await reopened.replay()).toEqual(await reopened.replay());
});

test.each(["system", "model"] as const)(
  "%s replay resource exhaustion is unsupported rather than invalid history",
  async (phase) => {
    const input = bytes(),
      system = createStandardSystemProfile(),
      oversized = "x".repeat(input.length);
    const handle = await openDocument({
      bytes: input,
      signer: await owner(),
      limits: { maxBytes: input.length },
      model: phase === "model" ? { ...model, initial: () => ({ value: oversized }) } : model,
      system: {
        ...system,
        async replay(options) {
          const result = await system.replay(options);
          if (!result.ok || phase !== "system") return result;
          return {
            ok: true,
            value: {
              ...result.value,
              events: result.value.events.map((item) => ({
                ...item,
                event: { ...item.event, data: { value: oversized } },
              })),
            },
          };
        },
      },
    });
    expect(handle.state()).toEqual({ status: "inspection", reason: "incompatible" });
    expect(handle.inspect()).toMatchObject({
      verification: { integrity: "valid" },
      [phase === "model" ? "application" : "system"]: "unsupported",
      findings: [{ code: "RESOURCE_LIMIT" }],
    });
    expect(handle.export()).toEqual(input);
  },
);

test("per-entry profile validation still rejects non-JSON output before model replay", async () => {
  const system = createStandardSystemProfile(),
    initial = vi.fn(model.initial),
    handle = await openDocument({
      bytes: bytes(),
      signer: await owner(),
      model: { ...model, initial },
      system: {
        ...system,
        async replay(options) {
          const result = await system.replay(options);
          if (!result.ok) return result;
          return {
            ok: true,
            value: {
              ...result.value,
              events: result.value.events.map((item) => ({
                ...item,
                event: { ...item.event, data: undefined as unknown as Json },
              })),
            },
          };
        },
      },
    });
  expect(handle.state()).toEqual({ status: "inspection", reason: "invalid" });
  expect(handle.inspect().findings[0].code).toBe("SYSTEM_FAILED");
  expect(initial).not.toHaveBeenCalled();
});

test("parseable failed verification retains detached untrusted history without running extensions", async () => {
  const system = createStandardSystemProfile(),
    replay = vi.fn(system.replay),
    initial = vi.fn(model.initial);
  for (const code of ["SIGNATURE_INVALID", "HASH_MISMATCH", "LINK_INVALID"] as const) {
    const wire = vector<Snapshot>("owner.document");
    if (code === "SIGNATURE_INVALID") wire.commits[1].signature = "A".repeat(86);
    if (code === "HASH_MISMATCH") wire.commits[1].subject.metadata = { message: "tamper" };
    if (code === "LINK_INVALID") {
      wire.commits[1].subject.parent = null;
      resign(wire);
    }
    const input = encoded(wire),
      handle = await openDocument({
        bytes: input,
        model: { ...model, initial },
        system: { ...system, replay },
        signer: await owner(),
      });
    expect(handle.state()).toEqual({ status: "inspection", reason: "invalid" });
    expect(handle.inspect().findings[0].code).toBe(code);
    expect(handle.inspect().history).toEqual(wire.commits);
    expect(() =>
      Object.assign(handle.inspect().history[1].subject, { nonce: "changed" }),
    ).toThrow();
    wire.commits.pop();
    expect(handle.inspect().history).toHaveLength(2);
    expect(handle.export()).toEqual(input);
    expect((await handle.verify()).findings[0].code).toBe(code);
    expect(await handle.dispatch("set", { value: "blocked" })).toMatchObject({
      ok: false,
      error: { code: "INSPECTION_ONLY" },
    });
    expect(await handle.replay()).toMatchObject({ ok: false, error: { code } });
  }
  const malformed = await openDocument({ bytes: new TextEncoder().encode("{broken") });
  expect(malformed.inspect().history).toEqual([]);
  expect(initial).not.toHaveBeenCalled();
  expect(replay).not.toHaveBeenCalled();
});
