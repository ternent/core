import { detached } from "../common/immutable.js";
import type { Snapshot } from "./types.js";
import type { VerifiedHistory } from "../system/types.js";
const issued = new WeakSet<object>();
export function issueHistory(snapshot: Snapshot): VerifiedHistory {
  let index = 0;
  const history = detached({
    documentId: snapshot.documentId,
    head: snapshot.head,
    declaration: snapshot.commits[0].subject.declaration!,
    ordered: snapshot.commits.flatMap((commit) =>
      commit.subject.entryIds.map(() => ({ commit, entry: snapshot.entries[index++] })),
    ),
  }) as unknown as VerifiedHistory;
  issued.add(history);
  return history;
}
export function isVerifiedHistory(value: VerifiedHistory): boolean {
  return issued.has(value);
}
