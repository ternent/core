import {
  inspectLedger,
  compareLedgers,
  hashLedgerEntry,
  hashLedgerCommit,
  ledgerSignatureMessage,
} from "@ternent/ledger/protocol";
import { caught, type Result } from "../common/errors.js";
import * as schema from "./schema.js";
import type { CommitRecord, Limits, Relationship, Snapshot, VerificationReport } from "./types.js";

export const hashEntrySubject = hashLedgerEntry;
export const hashCommitSubject = hashLedgerCommit;
export const signatureMessage = ledgerSignatureMessage;
export function ledgerLimits(limits: Limits) {
  return {
    maxBytes: limits.maxBytes,
    maxDepth: limits.maxDepth,
    maxEntries: limits.maxEntries,
    maxCommits: limits.maxCommits,
    maxMetadataBytes: limits.maxMetadataBytes,
    maxPayloadBytes: limits.maxBytes,
  };
}
export async function inspectProtocol(
  bytes: Uint8Array,
  options: { limits?: Partial<Limits> } = {},
): Promise<{
  report: VerificationReport;
  snapshot?: Snapshot;
  untrustedHistory: readonly CommitRecord[];
}> {
  let report: VerificationReport = {
    integrity: "invalid",
    documentId: null,
    head: null,
    checkedCommits: 0,
    checkedEntries: 0,
    findings: [],
  };
  let untrustedHistory: readonly CommitRecord[] = [];
  try {
    const limits = schema.limits(options.limits);
    const history = await inspectLedger(bytes, { limits: ledgerLimits(limits) });
    report = history.report as VerificationReport;
    untrustedHistory = history.untrustedHistory;
    if (!history.snapshot) return { report, untrustedHistory };
    schema.snapshot(history.snapshot, limits);
    return { report, snapshot: history.snapshot, untrustedHistory };
  } catch (cause) {
    const finding = caught(cause, "SCHEMA_INVALID", "protocol");
    return {
      report: {
        ...report,
        integrity: ["RESOURCE_LIMIT", "HOST_CONFIGURATION", "ENTRY_KIND_UNSUPPORTED"].includes(
          finding.code,
        )
          ? "unsupported"
          : "invalid",
        findings: [finding],
      },
      untrustedHistory,
    };
  }
}
export async function verifyDocument(
  bytes: Uint8Array,
  options?: { limits?: Partial<Limits> },
): Promise<VerificationReport> {
  return (await inspectProtocol(bytes, options)).report;
}
export async function compareSnapshots(
  a: Uint8Array,
  b: Uint8Array,
  options?: { limits?: Partial<Limits> },
): Promise<Result<Relationship>> {
  const left = await inspectProtocol(a, options),
    right = await inspectProtocol(b, options);
  if (!left.snapshot) return { ok: false, error: left.report.findings[0] };
  if (!right.snapshot) return { ok: false, error: right.report.findings[0] };
  return (await compareLedgers(a, b, {
    limits: ledgerLimits(schema.limits(options?.limits)),
  })) as Result<Relationship>;
}
