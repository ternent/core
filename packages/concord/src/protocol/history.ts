import { orderedEntries } from "@ternent/ledger/protocol";
import { detached } from "../common/immutable.js";
import { declaration, logicalEntry } from "./schema.js";
import type { Snapshot } from "./types.js";
import type { VerifiedHistory } from "../system/types.js";
const issued = new WeakSet<object>();
export function issueHistory(snapshot: Snapshot): VerifiedHistory {
  const history = detached({
    documentId: snapshot.documentId,
    head: snapshot.head,
    declaration: declaration(snapshot),
    ordered: Array.from(orderedEntries(snapshot), ({ commit, entry }) => ({
      commit,
      entry: logicalEntry(entry),
    })),
  }) as unknown as VerifiedHistory;
  issued.add(history);
  return history;
}
export function isVerifiedHistory(value: VerifiedHistory): boolean {
  return issued.has(value);
}
