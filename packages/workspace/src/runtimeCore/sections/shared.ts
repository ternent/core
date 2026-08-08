export type RuntimeCoreSharedContext<TIdentity> = {
  command: <TInput = unknown>(type: string, input: TInput) => Promise<any>;
  select: <TValue = unknown>(pluginId: string, selectorId: string, ...args: unknown[]) => TValue;
  getPluginState: <TState = unknown>(pluginId: string) => TState;
  activeIdentity: () => TIdentity | null;
};

export function resolveViewerIdentity(activeIdentity: {
  identityKey: string;
  identityId: string;
} | null): {
  viewerIdentityKey: string | null;
  viewerIdentityId: string | null;
} {
  return {
    viewerIdentityKey: activeIdentity?.identityKey ?? null,
    viewerIdentityId: activeIdentity?.identityId ?? null,
  };
}
