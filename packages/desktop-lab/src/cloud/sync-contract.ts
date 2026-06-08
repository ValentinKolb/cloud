export type DesktopCredentialKind = "session" | "api-token" | "device-code";

export type SyncScope = string;

export type SyncCursor = {
  scope: SyncScope;
  cursor: string | null;
};

export type SyncMutation = {
  id: string;
  scope: SyncScope;
  operation: "create" | "update" | "delete";
  payload: Record<string, unknown>;
  createdAt: string;
};

export type SyncPushRequest = {
  clientId: string;
  mutations: SyncMutation[];
};

export type SyncPushResponse = {
  accepted: string[];
  rejected: Array<{ id: string; message: string }>;
  nextCursor?: SyncCursor;
};

export type SyncPullRequest = {
  clientId: string;
  cursors: SyncCursor[];
};

export type SyncPullChange = {
  id: string;
  scope: SyncScope;
  operation: "upsert" | "delete";
  payload: Record<string, unknown>;
  updatedAt: string;
};

export type SyncPullResponse = {
  changes: SyncPullChange[];
  cursors: SyncCursor[];
};
