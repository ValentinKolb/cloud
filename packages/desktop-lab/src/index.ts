export const desktopLab = {
  id: "desktop-lab",
  name: "Markdown Desk",
  description: "Local-first Markdown desktop app showcasing Cloud UI and native filesystem access.",
} as const;

export default desktopLab;
export type {
  SyncCursor,
  SyncMutation,
  SyncPullChange,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from "./cloud/sync-contract";
