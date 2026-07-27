import type { Mailbox, MailboxHealth } from "../../contracts";

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
