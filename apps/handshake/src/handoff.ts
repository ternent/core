import { createHash, randomBytes } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { identityFromSeed, type IdentityCapability, type ReaderCapability } from "@ternent/armour";
import {
  createDocument,
  openDocument,
  type ConcordError,
  type DocumentHandle,
} from "@ternent/concord";
import { compareSnapshots } from "@ternent/concord/protocol";
import { createStandardSystemProfile, setMember } from "@ternent/concord/system";
import { handshakeModel, type HandshakeProjection, type HandshakeTerms } from "./model.js";

type Role = "sender" | "recipient";

type HandoffConfig = HandshakeTerms & {
  artifact: string;
  senderId: string;
  setupHead: string;
};

type Access = { reader?: ReaderCapability; signer?: IdentityCapability };

type Finding = { code: string; message: string; details?: ConcordError["details"] };

function failure(finding: Finding) {
  const modelCode = finding.details?.modelCode;
  const detail = typeof modelCode === "string" ? ` (${modelCode})` : "";
  return new Error(`${finding.code}: ${finding.message}${detail}`);
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: Finding }): T {
  if (!result.ok) throw failure(result.error);
  return result.value;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readOptional(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function requireUnpublished(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  throw new Error("SNAPSHOT_EXISTS: this stage already has a published snapshot");
}

async function publish(path: string, bytes: Uint8Array): Promise<void> {
  const temporary = await mkdtemp(join(dirname(path), ".candidate-"));
  const candidate = join(temporary, "snapshot.json");
  let retained = false;
  try {
    await writeFile(candidate, bytes, { flag: "wx", mode: 0o600 });
    try {
      await link(candidate, path);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      retained = true;
      const relationship = await compareSnapshots(bytes, await readFile(path));
      if (relationship.ok && relationship.value === "equal") {
        retained = false;
        return;
      }
      const relation = relationship.ok ? relationship.value : "unverified";
      const code = relation === "diverged" ? "DIVERGED_HEAD" : "PUBLICATION_CONFLICT";
      throw new Error(
        `${code}: concurrent publication (${relation}). The authored snapshot is retained for inspection.`,
      );
    }
  } finally {
    if (!retained) await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeIdentity(path: string): Promise<IdentityCapability> {
  const seed = randomBytes(32);
  try {
    const identity = unwrap(await identityFromSeed(seed));
    await writeFile(path, seed, { flag: "wx", mode: 0o600 });
    return identity;
  } finally {
    seed.fill(0);
  }
}

async function readIdentity(path: string): Promise<IdentityCapability> {
  const seed = await readFile(path);
  try {
    return unwrap(await identityFromSeed(seed));
  } finally {
    seed.fill(0);
  }
}

async function readReviewer(path: string): Promise<ReaderCapability> {
  const { publicIdentity, decryptAge } = await readIdentity(path);
  return { publicIdentity, decryptAge };
}

async function readConfig(directory: string): Promise<HandoffConfig> {
  const data: unknown = JSON.parse(await readFile(join(directory, "local.json"), "utf8"));
  if (
    !data ||
    typeof data !== "object" ||
    !("artifact" in data) ||
    typeof data.artifact !== "string" ||
    !("senderId" in data) ||
    typeof data.senderId !== "string" ||
    !("recipientId" in data) ||
    typeof data.recipientId !== "string" ||
    !("artifactSha256" in data) ||
    typeof data.artifactSha256 !== "string" ||
    !("setupHead" in data) ||
    typeof data.setupHead !== "string"
  )
    throw new Error("CONFIG_INVALID: use a directory created by init");
  return {
    artifact: data.artifact,
    senderId: data.senderId,
    recipientId: data.recipientId,
    artifactSha256: data.artifactSha256,
    setupHead: data.setupHead,
  };
}

function verifiedReport(
  handle: Pick<DocumentHandle<HandshakeProjection, never>, "state" | "inspect">,
) {
  const state = handle.state();
  const inspection = handle.inspect();
  if (state.status !== "ready") {
    const finding = inspection.findings[0];
    throw finding ? failure(finding) : new Error(state.reason);
  }
  return {
    documentId: state.documentId,
    head: state.head,
    freshness: inspection.freshness,
    otherRecipientsDecryptability: inspection.otherRecipientsDecryptability,
    ...state.projection,
  };
}

async function open(bytes: Uint8Array, access: Access, anchor?: Uint8Array) {
  const handle = await openDocument({
    bytes,
    model: handshakeModel,
    system: createStandardSystemProfile(),
    ...access,
    anchor,
  });
  return { handle, report: verifiedReport(handle) };
}

async function readSetup(directory: string, config: HandoffConfig, access: Access) {
  const bytes = await readFile(join(directory, "setup.json"));
  const { report } = await open(bytes, access);
  if (report.head !== config.setupHead || report.proposal)
    throw new Error("SETUP_MISMATCH: the setup snapshot differs from the local configuration");
  return bytes;
}

function requireTerms(proposal: { senderId: string } & HandshakeTerms, config: HandoffConfig) {
  if (
    proposal.senderId !== config.senderId ||
    proposal.recipientId !== config.recipientId ||
    proposal.artifactSha256 !== config.artifactSha256
  )
    throw new Error("TERMS_MISMATCH: the receipt differs from the configured handoff");
}

async function openProposal(
  bytes: Uint8Array,
  setup: Uint8Array,
  config: HandoffConfig,
  access: Access,
) {
  const proposal = await open(bytes, access, setup);
  if (!proposal.report.proposal || proposal.report.accepted)
    throw new Error("PROPOSAL_INVALID: expected a pending proposal snapshot");
  requireTerms(proposal.report.proposal, config);
  return proposal;
}

export async function initializeHandoff(directory: string, artifactPath: string) {
  const artifact = resolve(artifactPath);
  const artifactSha256 = sha256(await readFile(artifact));
  await mkdir(directory, { mode: 0o700 });
  try {
    const sender = await writeIdentity(join(directory, "sender.key"));
    const recipient = await writeIdentity(join(directory, "recipient.key"));
    const reviewer = await writeIdentity(join(directory, "reviewer.key"));
    const handle = unwrap(
      await createDocument({
        model: handshakeModel,
        system: createStandardSystemProfile(),
        identity: sender,
      }),
    );
    unwrap(
      await setMember(handle, {
        identity: recipient.publicIdentity,
        capabilities: ["read", "write"],
      }),
    );
    const { head: setupHead } = unwrap(
      await setMember(handle, { identity: reviewer.publicIdentity, capabilities: ["read"] }),
    );
    const config: HandoffConfig = {
      artifact,
      artifactSha256,
      senderId: sender.publicIdentity.id,
      recipientId: recipient.publicIdentity.id,
      setupHead,
    };
    await writeFile(join(directory, "local.json"), JSON.stringify(config), {
      flag: "wx",
      mode: 0o600,
    });
    await publish(join(directory, "setup.json"), handle.export());
    return { setupHead, artifactSha256 };
  } catch (error) {
    // mkdir exclusively reserved this directory for the failed initialization.
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function createHandoffOperations(directory: string, role: Role) {
  const config = await readConfig(directory);
  const signer = await readIdentity(join(directory, `${role}.key`));
  if (signer.publicIdentity.id !== (role === "sender" ? config.senderId : config.recipientId))
    throw new Error("SIGNER_MISMATCH: the signer differs from the configured role");
  const access = { signer };
  const setup = await readSetup(directory, config, access);
  const proposalPath = join(directory, "proposal.json");
  const receiptPath = join(directory, "receipt.json");

  async function status() {
    // Receipt publication follows proposal publication. Read them in reverse order.
    const accepted = await readOptional(receiptPath);
    const proposed = await readOptional(proposalPath);
    if (!proposed) {
      if (accepted)
        throw new Error("PROPOSAL_REQUIRED: the saved receipt has no proposal snapshot");
      return (await open(setup, access)).report;
    }
    const proposal = await openProposal(proposed, setup, config, access);
    if (!accepted) return proposal.report;
    return (await open(accepted, access, proposed)).report;
  }

  if (role === "sender")
    return {
      role,
      status,
      async propose() {
        await requireUnpublished(proposalPath);
        await requireUnpublished(receiptPath);
        const { handle } = await open(setup, access, setup);
        unwrap(
          await handle.dispatch("propose", {
            recipientId: config.recipientId,
            artifactSha256: config.artifactSha256,
          }),
        );
        const report = verifiedReport(handle);
        await publish(proposalPath, handle.export());
        return report;
      },
    } as const;

  return {
    role,
    status,
    async accept(terms: HandshakeTerms) {
      await requireUnpublished(receiptPath);
      const proposed = await readOptional(proposalPath);
      if (!proposed)
        throw new Error("PROPOSAL_REQUIRED: the sender must propose the handoff first");
      const { handle } = await openProposal(proposed, setup, config, access);
      unwrap(await handle.dispatch("accept", terms));
      const report = verifiedReport(handle);
      await publish(receiptPath, handle.export());
      return report;
    },
  } as const;
}

export async function verifyReceipt(
  receiptPath: string,
  reviewerPath: string,
  anchorPath?: string,
) {
  const reader = await readReviewer(reviewerPath);
  const anchor = anchorPath ? await readFile(anchorPath) : undefined;
  return (await open(await readFile(receiptPath), { reader }, anchor)).report;
}

export async function releaseArtifact(directory: string, rememberedPath?: string) {
  const config = await readConfig(directory);
  const access = { reader: await readReviewer(join(directory, "reviewer.key")) };
  const setup = await readSetup(directory, config, access);
  const proposed = await readFile(join(directory, "proposal.json"));
  await openProposal(proposed, setup, config, access);
  const receipt = await readFile(join(directory, "receipt.json"));
  const { report } = await open(receipt, access, proposed);
  if (rememberedPath) await open(receipt, access, await readFile(rememberedPath));
  if (!report.accepted || !report.proposal)
    throw new Error("ACCEPTANCE_REQUIRED: the recipient has not accepted the proposal");
  requireTerms(report.proposal, config);
  const artifact = await readFile(config.artifact);
  if (sha256(artifact) !== report.proposal.artifactSha256)
    throw new Error("ARTIFACT_MISMATCH: the current bytes differ from the accepted artifact");
  return artifact;
}
