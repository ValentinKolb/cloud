import type { Mailbox, MailboxHealth, MailboxOperationalHealth } from "../../contracts";

type MailboxHealthPresentation = {
  title: string;
  message: string;
  tone: "info" | "warning";
  action: "health" | "delivery" | null;
  actionLabel: string | null;
};

const timedOut = (reason: string | null): boolean =>
  reason?.toLowerCase().includes("failed to establish connection in required time") === true;

export const mailboxHealthPresentation = (mailbox: Pick<Mailbox, "health" | "healthReason">): MailboxHealthPresentation | null => {
  const presentations: Record<MailboxHealth, MailboxHealthPresentation | null> = {
    active: null,
    paused: {
      title: "Mail sync is paused",
      message: "New mail will not appear until synchronization is resumed.",
      tone: "warning",
      action: "health",
      actionLabel: "Resume sync",
    },
    degraded: timedOut(mailbox.healthReason)
      ? {
          title: "Mail is taking longer to connect",
          message: "The saved account is valid, but the latest synchronization timed out. Mail will retry automatically.",
          tone: "warning",
          action: "health",
          actionLabel: "View status",
        }
      : {
          title: "Mail could not synchronize",
          message: "The saved account is still connected. Review the connection status for details and recovery actions.",
          tone: "warning",
          action: "health",
          actionLabel: "View status",
        },
    auth_required: {
      title: "Mail needs you to sign in again",
      message: "Reconnect the account before new messages can be synchronized or sent.",
      tone: "warning",
      action: "delivery",
      actionLabel: "Reconnect account",
    },
    connection_required: {
      title: "Connect a mail account",
      message: "This mailbox has no usable provider connection.",
      tone: "warning",
      action: "delivery",
      actionLabel: "Open delivery settings",
    },
    disconnected: {
      title: "Connect a mail account",
      message: "This mailbox is not connected to a mail provider yet.",
      tone: "warning",
      action: "delivery",
      actionLabel: "Open delivery settings",
    },
    verifying: {
      title: "Checking the mail account",
      message: "Mail is verifying the provider connection. This usually takes only a moment.",
      tone: "info",
      action: "health",
      actionLabel: "View status",
    },
    bootstrapping: {
      title: "Mail is finishing setup",
      message: "Messages are being synchronized for the first time and may appear gradually.",
      tone: "info",
      action: "health",
      actionLabel: "View status",
    },
    reconnecting: {
      title: "Mail is reconnecting",
      message: "New messages may take a moment to appear while the provider connection recovers.",
      tone: "info",
      action: "health",
      actionLabel: "View status",
    },
  };
  return presentations[mailbox.health];
};

const countLabel = (count: number, singular: string, plural = `${singular}s`): string => `${count} ${count === 1 ? singular : plural}`;

export const mailboxOperationalHealthSummary = (
  health: MailboxOperationalHealth,
): { accounts: string; discovery: string; synchronization: string; search: string } => {
  const reviewCount = health.discovery.missingFolders + health.discovery.ambiguousFolders;
  const degradedFolders = health.sync.folderStates.degraded ?? 0;
  const currentFolders = health.sync.folderStates.current ?? 0;
  const rebuildingFolders = health.sync.folderStates.rebuilding ?? 0;
  const syncingFolders = health.sync.folderStates.syncing ?? 0;
  const pendingFolders = health.sync.folderStates.pending ?? 0;

  const accounts =
    health.bindings.degraded > 0
      ? `${health.bindings.active > 0 ? `${countLabel(health.bindings.active, "connected account")} · ` : ""}${countLabel(
          health.bindings.degraded,
          "degraded account",
        )}`
      : health.bindings.active > 0
        ? countLabel(health.bindings.active, "connected account")
        : health.bindings.pending > 0
          ? countLabel(health.bindings.pending, "account pending", "accounts pending")
          : "No connected account";
  const discovery = `${countLabel(health.discovery.activeFolders, "discovered folder")}${
    reviewCount > 0 ? ` · ${countLabel(reviewCount, "needs review", "need review")}` : ""
  }`;
  const synchronization =
    health.sync.runningRuns > 0
      ? countLabel(health.sync.runningRuns, "synchronization running", "synchronizations running")
      : degradedFolders > 0
        ? `${countLabel(degradedFolders, "degraded folder")}${currentFolders > 0 ? ` · ${countLabel(currentFolders, "current folder")}` : ""}`
        : rebuildingFolders > 0
          ? countLabel(rebuildingFolders, "folder rebuilding", "folders rebuilding")
          : syncingFolders > 0
            ? countLabel(syncingFolders, "folder synchronizing", "folders synchronizing")
            : currentFolders > 0
              ? countLabel(currentFolders, "current folder")
              : pendingFolders > 0
                ? countLabel(pendingFolders, "folder pending", "folders pending")
                : "No synchronized folders";
  const search = health.search.bm25Ready ? "Search available · advanced" : "Search available · standard";

  return { accounts, discovery, synchronization, search };
};

export const formatHealthEventAge = (input: string, base: Date = new Date()): string => {
  const elapsedMs = Math.max(0, base.getTime() - Date.parse(input));
  if (elapsedMs < 5_000) return "just now";

  const units = [
    [24 * 60 * 60 * 1_000, "day"],
    [60 * 60 * 1_000, "hour"],
    [60 * 1_000, "minute"],
    [1_000, "second"],
  ] as const;
  const [unitMs, unit] = units.find(([threshold]) => elapsedMs >= threshold) ?? units.at(-1)!;
  return new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(-Math.floor(elapsedMs / unitMs), unit);
};
