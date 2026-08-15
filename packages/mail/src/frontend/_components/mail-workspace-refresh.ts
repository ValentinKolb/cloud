export type MailWorkspaceRefreshResult = "applied" | "failed" | "stale";

export const requireMailWorkspaceRefresh = async (refresh: () => Promise<MailWorkspaceRefreshResult>, message: string): Promise<void> => {
  if ((await refresh()) === "failed") throw new Error(message);
};

export const captureMailWorkspaceRefreshError = async (refresh: () => Promise<void>): Promise<Error | null> => {
  try {
    await refresh();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
};
