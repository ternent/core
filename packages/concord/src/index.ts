import { base64urlnopad } from "@scure/base";
import { decrypt, encrypt } from "@ternent/armour";
import { validatePublicIdentity, type Identity, type PublicIdentity } from "@ternent/identity";
import { createLedger, createWriter, openLedger, type Commit, type History } from "@ternent/ledger";
import { generateX25519Identity, identityToRecipient } from "age-encryption";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Event = { type: string; data: Json };
export type Role = "member" | "admin";
export type GroupId = `group:${string}`;
export type Member = { identity: PublicIdentity; role: Role };
export type Group = { id: GroupId; default: boolean; members: Member[] };
export type Rejection = {
  commit: string;
  group: GroupId;
  reason: "authority" | "application";
  message: string;
};
export type Returned = { commit: string; group: GroupId; events: Event[]; message: string };
export type ReduceContext = { author: PublicIdentity; version: number };

export type Model<S extends Json> = {
  id: string;
  version: number;
  initial(): S;
  reduce(state: S, event: Event, context: ReduceContext): S;
  squash?(events: readonly Event[]): Event[];
};

export function defineModel<S extends Json>(model: Model<S>): Model<S> {
  return model;
}

type Epoch = { secret: string; recipient: string };
type GroupState = {
  id: GroupId;
  isDefault: boolean;
  members: Map<string, Member>;
  epochs: Map<number, Epoch>;
  current: number;
  state: Json;
  unsupported?: string;
};
type Replay = {
  groups: Map<GroupId, GroupState>;
  candidates: Map<GroupId, Map<number, string>>;
  // Entries that are key wraps to this identity; they are not group records.
  wraps: Set<string>;
  rejected: Rejection[];
  unreadable: number;
  // This identity's application commits, kept for rebase.
  authored: Map<string, { group: GroupId; events: Event[] }>;
};
type Body =
  | { op: "create"; id: GroupId; model: string; members: Member[] }
  | { op: "set"; identity: PublicIdentity; role: Role }
  | { op: "remove"; identity: PublicIdentity; epoch: number }
  | { op: "events"; events: Event[]; version: number };

const KIND = "concord";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class Rejected extends Error {
  constructor(
    readonly reason: Rejection["reason"],
    message: string,
  ) {
    super(message);
  }
}

class ConcordDocument<S extends Json> {
  readonly #model: Model<S>;
  readonly #identity: Identity;
  #history: History;
  #replay: Replay;
  #draft: { group: GroupId; events: Event[]; state: S } | null = null;

  constructor(model: Model<S>, identity: Identity, history: History, replay: Replay) {
    this.#model = model;
    this.#identity = identity;
    this.#history = history;
    this.#replay = replay;
  }

  get head(): string {
    return this.#history.head;
  }

  get draft(): { group: GroupId; events: readonly Event[]; state: S } | null {
    return this.#draft;
  }

  get rejected(): readonly Rejection[] {
    return this.#replay.rejected;
  }

  get unreadable(): number {
    return this.#replay.unreadable;
  }

  get groups(): Group[] {
    return [...this.#replay.groups.values()].map((group) => ({
      id: group.id,
      default: group.isDefault,
      members: [...group.members.values()],
    }));
  }

  export(): Uint8Array {
    return this.#history.export();
  }

  state(group?: GroupId): S {
    return this.#readable(group ?? this.#defaultGroup()).state as S;
  }

  stage(event: Event, options: { group?: GroupId } = {}): void {
    const id = options.group ?? this.#draft?.group ?? this.#defaultGroup();
    if (this.#draft && this.#draft.group !== id) {
      throw new Error("A draft holds events for one group; commit or discard it first");
    }
    const group = this.#readable(id);
    if (!group.members.has(this.#identity.publicIdentity.id)) {
      throw new Error("Only members of a group can write to it");
    }
    const captured = captureEvent(event);
    const context = { author: this.#identity.publicIdentity, version: this.#model.version };
    const base = (this.#draft?.state ?? group.state) as S;
    const state = deepFreeze(this.#model.reduce(base, captured, context));
    this.#draft = { group: id, events: [...(this.#draft?.events ?? []), captured], state };
  }

  discard(): void {
    this.#draft = null;
  }

  async commit(): Promise<void> {
    await this.#commitDraft(true);
  }

  async createGroup(): Promise<GroupId> {
    this.#noDraft();
    const id: GroupId = `group:${base64urlnopad.encode(crypto.getRandomValues(new Uint8Array(16)))}`;
    await this.#append(await createEntries(id, this.#model.id, this.#identity.publicIdentity));
    return id;
  }

  async setMember(
    identity: PublicIdentity,
    options: { group: GroupId; role: Role },
  ): Promise<void> {
    this.#noDraft();
    const group = this.#administered(options.group);
    const target = validatePublicIdentity(identity);
    if (options.role !== "member" && options.role !== "admin") throw new Error("Unknown role");
    const existing = group.members.get(target.id);
    if (existing?.role === options.role) throw new Error("The member already has that role");
    if (existing?.role === "admin" && lastAdmin(group, target.id)) {
      throw new Error("A group keeps at least one admin");
    }
    const entries = [
      await sealGroup({ op: "set", identity: target, role: options.role }, currentEpoch(group)),
    ];
    if (!existing) {
      // A new member receives every epoch, so they can read the whole history.
      const epochs = Object.fromEntries([...group.epochs].map(([n, epoch]) => [n, epoch.secret]));
      entries.push(await sealWrap(group.id, epochs, [target]));
    }
    await this.#append(entries);
  }

  async removeMember(identity: PublicIdentity, options: { group: GroupId }): Promise<void> {
    this.#noDraft();
    const group = this.#administered(options.group);
    const target = validatePublicIdentity(identity);
    const existing = group.members.get(target.id);
    if (!existing) throw new Error("Not a member of this group");
    if (existing.role === "admin" && lastAdmin(group, target.id)) {
      throw new Error("A group keeps at least one admin");
    }
    const epoch = group.current + 1;
    const secret = await generateX25519Identity();
    const next = { secret, recipient: await identityToRecipient(secret) };
    const remaining = [...group.members.values()]
      .filter((member) => member.identity.id !== target.id)
      .map((member) => member.identity);
    await this.#append([
      await sealGroup({ op: "remove", identity: existing.identity, epoch }, next),
      await sealWrap(group.id, { [epoch]: secret }, remaining),
    ]);
  }

  async rebase(remote: Uint8Array, options: { published: string }): Promise<Returned[]> {
    this.#noDraft();
    const local = this.#history.commits;
    const start = local.findIndex((commit) => commit.id === options.published);
    if (start < 0) throw new Error("The published head is not in this history");
    const other = await open(remote, this.#model, this.#identity);
    const remoteIds = new Set<string>(other.#history.commits.map((commit) => commit.id));
    if (!remoteIds.has(options.published)) {
      throw new Error("The published head is not in the remote history");
    }
    const pending = local.slice(start + 1).filter((commit) => !remoteIds.has(commit.id));
    for (const commit of pending) {
      if (commit.proof.signer.id !== this.#identity.publicIdentity.id) {
        throw new Error(`Commit ${commit.id} is another identity's unpublished work`);
      }
      if (!this.#replay.authored.has(commit.id)) {
        throw new Error(`Commit ${commit.id} changes membership; publish or redo it first`);
      }
    }
    const returned: Returned[] = [];
    for (const commit of pending) {
      const { group, events } = this.#replay.authored.get(commit.id)!;
      try {
        for (const event of events) other.stage(event, { group });
        await other.#commitDraft(false);
      } catch (error) {
        other.discard();
        returned.push({ commit: commit.id, group, events, message: messageOf(error) });
      }
    }
    this.#history = other.#history;
    this.#replay = other.#replay;
    return returned;
  }

  async #commitDraft(squash: boolean): Promise<void> {
    const draft = this.#draft;
    if (!draft) throw new Error("Nothing is staged");
    const group = this.#readable(draft.group);
    let events = draft.events;
    if (squash && this.#model.squash) {
      events = this.#model.squash(draft.events.map((event) => structuredClone(event)));
      events = events.map(captureEvent);
      const context = { author: this.#identity.publicIdentity, version: this.#model.version };
      const squashed = events.reduce(
        (state, event) => deepFreeze(this.#model.reduce(state, event, context)),
        group.state as S,
      );
      if (!sameJson(squashed, draft.state)) {
        throw new Error("squash changed the result of the staged events");
      }
    }
    const body: Body = { op: "events", events, version: this.#model.version };
    await this.#append([await sealGroup(body, currentEpoch(group))]);
    this.#draft = null;
  }

  // Signs `ciphertexts` as one commit, then adopts it only if this identity's own replay
  // accepts it, so a failure leaves history and state unchanged.
  async #append(ciphertexts: Uint8Array[]): Promise<void> {
    const writer = createWriter(this.#history, this.#identity);
    writer.append(
      ciphertexts.map((bytes) => ({ kind: KIND, payload: base64urlnopad.encode(bytes) })),
    );
    const history = await writer.commit();
    const replay = cloneReplay(this.#replay);
    const commit = history.commits[history.commits.length - 1];
    await discover(commit, this.#identity, replay);
    await apply(commit, history.commits.length - 1, this.#model, this.#identity, replay);
    const rejection = replay.rejected.find((entry) => entry.commit === commit.id);
    if (rejection) throw new Error(`The commit was not accepted: ${rejection.message}`);
    this.#history = history;
    this.#replay = replay;
  }

  #defaultGroup(): GroupId {
    const group = [...this.#replay.groups.values()].find((entry) => entry.isDefault);
    if (!group) throw new Error("This identity cannot read the default group");
    return group.id;
  }

  #readable(id: GroupId): GroupState {
    const group = this.#replay.groups.get(id);
    if (!group) throw new Error(`This identity cannot read group ${id}`);
    if (group.unsupported) throw new Error(group.unsupported);
    return group;
  }

  #administered(id: GroupId): GroupState {
    const group = this.#readable(id);
    if (group.members.get(this.#identity.publicIdentity.id)?.role !== "admin") {
      throw new Error("Only an admin of the group can change its membership");
    }
    return group;
  }

  #noDraft(): void {
    if (this.#draft) throw new Error("Commit or discard the draft first");
  }

  static async create<S extends Json>(
    model: Model<S>,
    identity: Identity,
  ): Promise<ConcordDocument<S>> {
    const id: GroupId = `group:${base64urlnopad.encode(crypto.getRandomValues(new Uint8Array(16)))}`;
    const entries = await createEntries(id, model.id, identity.publicIdentity);
    const history = await createLedger({
      signer: identity,
      entries: entries.map((bytes) => ({ kind: KIND, payload: base64urlnopad.encode(bytes) })),
    });
    return replayHistory(history, model, identity);
  }
}

export type Document<S extends Json> = ConcordDocument<S>;

export async function createDocument<S extends Json>(input: {
  model: Model<S>;
  identity: Identity;
}): Promise<Document<S>> {
  return ConcordDocument.create(input.model, input.identity);
}

export async function openDocument<S extends Json>(
  bytes: Uint8Array,
  input: { model: Model<S>; identity: Identity },
): Promise<Document<S>> {
  return open(bytes, input.model, input.identity);
}

async function open<S extends Json>(
  bytes: Uint8Array,
  model: Model<S>,
  identity: Identity,
): Promise<ConcordDocument<S>> {
  return replayHistory(await openLedger(bytes), model, identity);
}

// Opening is three passes: Ledger verifies the history, every wrap is decrypted to find
// candidate keys, then each group replays in order. A key gains authority only when an
// accepted record establishes its epoch, never because it decrypts something.
async function replayHistory<S extends Json>(
  history: History,
  model: Model<S>,
  identity: Identity,
): Promise<ConcordDocument<S>> {
  const replay: Replay = {
    groups: new Map(),
    candidates: new Map(),
    wraps: new Set(),
    rejected: [],
    unreadable: 0,
    authored: new Map(),
  };
  for (const commit of history.commits) await discover(commit, identity, replay);
  for (const [index, commit] of history.commits.entries()) {
    await apply(commit, index, model, identity, replay);
  }
  return new ConcordDocument(model, identity, history, replay);
}

async function discover(commit: Commit, identity: Identity, replay: Replay): Promise<void> {
  for (const entry of commit.entries) {
    const opened = await tryDecrypt(entry.payload, identity);
    if (opened === undefined) continue;
    const wrap = readWrap(opened);
    if (!wrap) continue;
    replay.wraps.add(entry.id);
    const known = replay.candidates.get(wrap.group) ?? new Map<number, string>();
    for (const [epoch, secret] of wrap.epochs) known.set(epoch, secret);
    replay.candidates.set(wrap.group, known);
  }
}

async function apply<S extends Json>(
  commit: Commit,
  index: number,
  model: Model<S>,
  identity: Identity,
  replay: Replay,
): Promise<void> {
  const opened: { group: GroupId; epoch: number; secret: string; body: unknown }[] = [];
  for (const entry of commit.entries) {
    if (replay.wraps.has(entry.id)) continue;
    const found = await openGroupEntry(entry.payload, replay.candidates);
    if (found) opened.push(found);
    else replay.unreadable += 1;
  }
  const byGroup = new Map<GroupId, typeof opened>();
  for (const entry of opened)
    byGroup.set(entry.group, [...(byGroup.get(entry.group) ?? []), entry]);
  const signer = commit.proof.signer;
  for (const [groupId, entries] of byGroup) {
    try {
      if (entries.length !== 1)
        throw new Rejected("authority", "A commit holds one record per group");
      const [{ epoch, secret, body: raw }] = entries;
      const body = readBody(raw);
      if (body.op === "events" && signer.id === identity.publicIdentity.id) {
        replay.authored.set(commit.id, { group: groupId, events: body.events });
      }
      await applyRecord(groupId, epoch, secret, body, signer, index === 0, model, replay);
    } catch (error) {
      if (!(error instanceof Rejected)) throw error;
      replay.rejected.push({
        commit: commit.id,
        group: groupId,
        reason: error.reason,
        message: error.message,
      });
    }
  }
}

async function applyRecord<S extends Json>(
  groupId: GroupId,
  epoch: number,
  secret: string,
  body: Body,
  signer: PublicIdentity,
  genesis: boolean,
  model: Model<S>,
  replay: Replay,
): Promise<void> {
  if (body.op === "create") {
    if (replay.groups.has(groupId) || epoch !== 0 || body.id !== groupId) {
      throw new Rejected("authority", "Invalid group creation");
    }
    if (
      body.members.length !== 1 ||
      body.members[0].role !== "admin" ||
      body.members[0].identity.id !== signer.id
    ) {
      throw new Rejected("authority", "A group is created with its signer as the only admin");
    }
    replay.groups.set(groupId, {
      id: groupId,
      isDefault: genesis,
      members: new Map([[signer.id, body.members[0]]]),
      epochs: new Map([[0, { secret, recipient: await identityToRecipient(secret) }]]),
      current: 0,
      state: deepFreeze(model.initial()),
      unsupported:
        body.model === model.id ? undefined : `Group ${groupId} uses model ${body.model}`,
    });
    return;
  }
  const group = replay.groups.get(groupId);
  if (!group) throw new Rejected("authority", "Unknown group");
  if (group.unsupported) return;
  const author = group.members.get(signer.id);

  if (body.op === "events") {
    if (!author) throw new Rejected("authority", "The author is not a member");
    if (epoch !== group.current)
      throw new Rejected("authority", "Encrypted to an epoch that is not current");
    if (body.version > model.version) {
      group.unsupported = `Group ${groupId} needs model version ${body.version}`;
      return;
    }
    const context = { author: signer, version: body.version };
    let state = group.state as S;
    try {
      for (const event of body.events) state = deepFreeze(model.reduce(state, event, context));
    } catch (error) {
      throw new Rejected("application", messageOf(error));
    }
    group.state = state;
    return;
  }

  if (author?.role !== "admin")
    throw new Rejected("authority", "Only an admin can change membership");
  const target = group.members.get(body.identity.id);

  if (body.op === "set") {
    if (epoch !== group.current)
      throw new Rejected("authority", "Encrypted to an epoch that is not current");
    if (target?.role === body.role) throw new Rejected("authority", "No change");
    if (target?.role === "admin" && lastAdmin(group, target.identity.id)) {
      throw new Rejected("authority", "A group keeps at least one admin");
    }
    group.members.set(body.identity.id, { identity: body.identity, role: body.role });
    return;
  }

  if (epoch !== group.current + 1 || body.epoch !== epoch) {
    throw new Rejected("authority", "A removal starts the next epoch");
  }
  if (!target) throw new Rejected("authority", "Not a member");
  if (target.role === "admin" && lastAdmin(group, target.identity.id)) {
    throw new Rejected("authority", "A group keeps at least one admin");
  }
  group.members.delete(target.identity.id);
  group.epochs.set(epoch, { secret, recipient: await identityToRecipient(secret) });
  group.current = epoch;
}

async function openGroupEntry(
  payload: unknown,
  candidates: Replay["candidates"],
): Promise<{ group: GroupId; epoch: number; secret: string; body: unknown } | undefined> {
  for (const [group, epochs] of candidates) {
    for (const [epoch, secret] of epochs) {
      const opened = await tryDecrypt(payload, secret);
      if (opened !== undefined) return { group, epoch, secret, body: opened };
    }
  }
  return undefined;
}

async function tryDecrypt(payload: unknown, key: Identity | string): Promise<unknown> {
  if (typeof payload !== "string") return undefined;
  try {
    return JSON.parse(decoder.decode(await decrypt(base64urlnopad.decode(payload), key)));
  } catch {
    return undefined;
  }
}

async function createEntries(
  id: GroupId,
  model: string,
  creator: PublicIdentity,
): Promise<Uint8Array[]> {
  const secret = await generateX25519Identity();
  const epoch = { secret, recipient: await identityToRecipient(secret) };
  return [
    await sealGroup(
      { op: "create", id, model, members: [{ identity: creator, role: "admin" }] },
      epoch,
    ),
    await sealWrap(id, { 0: secret }, [creator]),
  ];
}

async function sealGroup(body: Body, epoch: Epoch): Promise<Uint8Array> {
  return encrypt(encoder.encode(JSON.stringify({ concord: 1, ...body })), [epoch.recipient]);
}

async function sealWrap(
  group: GroupId,
  epochs: Record<number, string>,
  recipients: PublicIdentity[],
): Promise<Uint8Array> {
  return encrypt(encoder.encode(JSON.stringify({ concord: 1, group, epochs })), recipients);
}

function readWrap(value: unknown): { group: GroupId; epochs: [number, string][] } | undefined {
  if (
    !isRecord(value) ||
    value.concord !== 1 ||
    !isGroupId(value.group) ||
    !isRecord(value.epochs)
  ) {
    return undefined;
  }
  const epochs = Object.entries(value.epochs).map(
    ([key, secret]) => [Number(key), secret] as const,
  );
  if (
    !epochs.every(([n, secret]) => Number.isSafeInteger(n) && n >= 0 && typeof secret === "string")
  ) {
    return undefined;
  }
  return { group: value.group, epochs: epochs as [number, string][] };
}

function readBody(value: unknown): Body {
  const invalid = () => new Rejected("authority", "Malformed record");
  if (!isRecord(value) || value.concord !== 1) throw invalid();
  if (Array.isArray(value.events)) {
    if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) throw invalid();
    try {
      return {
        op: "events",
        events: value.events.map(captureEvent),
        version: value.version as number,
      };
    } catch {
      throw invalid();
    }
  }
  try {
    if (
      value.op === "create" &&
      isGroupId(value.id) &&
      typeof value.model === "string" &&
      Array.isArray(value.members)
    ) {
      return {
        op: "create",
        id: value.id,
        model: value.model,
        members: value.members.map(readMember),
      };
    }
    if (value.op === "set" && (value.role === "member" || value.role === "admin")) {
      return { op: "set", identity: validatePublicIdentity(value.identity), role: value.role };
    }
    if (value.op === "remove" && Number.isSafeInteger(value.epoch)) {
      return {
        op: "remove",
        identity: validatePublicIdentity(value.identity),
        epoch: value.epoch as number,
      };
    }
  } catch {
    throw invalid();
  }
  throw invalid();
}

function readMember(value: unknown): Member {
  if (!isRecord(value) || (value.role !== "member" && value.role !== "admin")) {
    throw new Error("Malformed member");
  }
  return { identity: validatePublicIdentity(value.identity), role: value.role };
}

function captureEvent(value: unknown): Event {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    value.type.length < 1 ||
    value.type.length > 128
  ) {
    throw new TypeError("An event is { type, data } with a type of 1 to 128 characters");
  }
  if (!isJson(value.data)) throw new TypeError("Event data must be JSON");
  return { type: value.type, data: structuredClone(value.data) };
}

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every(isJson)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGroupId(value: unknown): value is GroupId {
  return typeof value === "string" && /^group:[A-Za-z0-9_-]{22}$/.test(value);
}

function currentEpoch(group: GroupState): Epoch {
  const epoch = group.epochs.get(group.current);
  if (!epoch) throw new Error("This identity does not hold the group's current key");
  return epoch;
}

function lastAdmin(group: GroupState, id: string): boolean {
  return ![...group.members.values()].some(
    (member) => member.role === "admin" && member.identity.id !== id,
  );
}

function cloneReplay(replay: Replay): Replay {
  return {
    groups: new Map(
      [...replay.groups].map(([id, group]) => [
        id,
        { ...group, members: new Map(group.members), epochs: new Map(group.epochs) },
      ]),
    ),
    candidates: new Map([...replay.candidates].map(([id, epochs]) => [id, new Map(epochs)])),
    wraps: new Set(replay.wraps),
    rejected: [...replay.rejected],
    unreadable: replay.unreadable,
    authored: new Map(replay.authored),
  };
}

// Compares JSON values regardless of object key order.
function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameJson(v, b[i]))
    );
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
    );
  }
  return a === b;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
