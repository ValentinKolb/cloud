import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { Mailbox, MailSubscriptionPage } from "../contracts";
import * as access from "./access";
import type { MailRequestContext } from "./auth";
import { latestMailCollaborationEventCursor } from "./events";
import { listSubscriptions } from "./list-subscriptions";
import * as mailboxes from "./mailboxes";

export type MailSubscriptionWorkspaceData = {
  mailbox: Mailbox;
  permission: "read" | "write" | "admin";
  subscriptions: MailSubscriptionPage;
  initialLiveCursor: string | null;
};

export const loadMailSubscriptionWorkspace = async (
  context: MailRequestContext,
  mailboxId: string,
  focusedListKey: string | null = null,
): Promise<Result<MailSubscriptionWorkspaceData>> => {
  const permission = await access.getMailboxPermission(context, mailboxId);
  if (permission === "none") return fail(err.forbidden("Access denied"));

  // Capture before the snapshot so replay closes the SSR-to-WebSocket race.
  const initialLiveCursor = await latestMailCollaborationEventCursor(mailboxId).catch(() => null);
  const [mailbox, subscriptions] = await Promise.all([
    mailboxes.getMailbox(context, mailboxId),
    listSubscriptions({ context, mailboxId, limit: 50, focusedListKey: focusedListKey ?? undefined }),
  ]);
  if (!mailbox.ok) return mailbox;
  if (!subscriptions.ok) return subscriptions;
  return ok({
    mailbox: mailbox.data,
    permission,
    subscriptions: subscriptions.data,
    initialLiveCursor,
  });
};
