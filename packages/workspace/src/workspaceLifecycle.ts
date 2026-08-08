import type { RuntimeCore } from "./runtimeCore";

export type WorkspaceContainer = Awaited<ReturnType<RuntimeCore["exportLedger"]>>;

export type WorkspaceSummary = {
  providerId: string;
  workspaceId: string;
  pointer: string;
  head: string;
  commitCount: number;
  entryCount: number;
};

type WorkspaceLifecycleRuntime = Pick<
  RuntimeCore,
  "createLedger" | "reopen" | "exportLedger" | "importLedger"
> & {
  storage: Pick<RuntimeCore["storage"], "getActiveRef">;
};

export function shortWorkspaceHead(value: string): string {
  return value.slice(0, 12);
}

export async function readWorkspaceSummary(
  runtime: WorkspaceLifecycleRuntime,
): Promise<WorkspaceSummary> {
  const [activeRef, ledger] = await Promise.all([
    runtime.storage.getActiveRef(),
    runtime.exportLedger(),
  ]);

  return {
    providerId: activeRef.providerId,
    workspaceId: activeRef.workspaceId,
    pointer: activeRef.pointer,
    head: ledger.head,
    commitCount: Object.keys(ledger.commits).length,
    entryCount: Object.keys(ledger.entries).length,
  };
}

export async function createLocalWorkspace(
  runtime: Pick<RuntimeCore, "createLedger">,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await runtime.createLedger({
    workspaceMode: "local",
    ...metadata,
  });
}

export async function reopenCurrentWorkspace(
  runtime: Pick<RuntimeCore, "reopen">,
): Promise<void> {
  await runtime.reopen();
}

export async function exportWorkspaceContainer(
  runtime: Pick<RuntimeCore, "exportLedger">,
): Promise<WorkspaceContainer> {
  return await runtime.exportLedger();
}

export async function importWorkspaceContainer(
  runtime: Pick<RuntimeCore, "importLedger">,
  container: WorkspaceContainer,
): Promise<void> {
  await runtime.importLedger(container);
}

export function buildWorkspaceExportFile(
  container: WorkspaceContainer,
  prefix = "concord-workspace",
): {
  filename: string;
  content: string;
} {
  return {
    filename: `${prefix}-${shortWorkspaceHead(container.head)}.json`,
    content: JSON.stringify(container, null, 2),
  };
}

export function parseWorkspaceImportJson(content: string): WorkspaceContainer {
  return JSON.parse(content) as WorkspaceContainer;
}
