import { err, fail, ok, type Result } from "@k2b/stdlib";
import { z } from "zod";
import { type ConversationView, type ConversationWorkStatus, conversationViewSchema, conversationWorkStatusSchema } from "../contracts";

export type ConversationCursorScope = {
  mailboxId: string;
  folderId: string | null;
  status: ConversationWorkStatus | null;
  view: ConversationView | null;
  unread: boolean | null;
  userId: string | null;
};

type ConversationCursor = {
  version: 3;
  scope: ConversationCursorScope;
  date: string;
  id: string;
};

const conversationCursorSchema = z.object({
  version: z.literal(3),
  scope: z.object({
    mailboxId: z.uuid(),
    folderId: z.uuid().nullable(),
    status: conversationWorkStatusSchema.nullable(),
    view: conversationViewSchema.nullable(),
    unread: z.boolean().nullable(),
    userId: z.uuid().nullable(),
  }),
  date: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

const sameScope = (left: ConversationCursorScope, right: ConversationCursorScope): boolean =>
  left.mailboxId === right.mailboxId &&
  left.folderId === right.folderId &&
  left.status === right.status &&
  left.view === right.view &&
  left.unread === right.unread &&
  left.userId === right.userId;

export const encodeConversationCursor = (cursor: Omit<ConversationCursor, "version">): string =>
  Buffer.from(JSON.stringify({ version: 3, ...cursor })).toString("base64url");

export const decodeConversationCursor = (
  value: string | undefined,
  expectedScope: ConversationCursorScope,
): Result<ConversationCursor | null> => {
  if (!value) return ok(null);
  try {
    const parsed = conversationCursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (!parsed.success || !sameScope(parsed.data.scope, expectedScope)) {
      return fail(err.badInput("Invalid pagination cursor"));
    }
    return ok(parsed.data);
  } catch {
    return fail(err.badInput("Invalid pagination cursor"));
  }
};
