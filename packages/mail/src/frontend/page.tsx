import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import { mailFocusViewSchema } from "../contracts";
import type { MailRequestContext } from "../service";
import { focus, mailboxes } from "../service";
import { readMailWorkspacePreferences } from "./_components/mail-workspace-preferences";
import MailOverview from "./MailOverview.island";
import { projectSsrFocusItems, projectSsrMailboxList } from "./ssr-public-boundary";

export default ssr<AuthContext>(async (c) => {
  const actor = c.get("actor");
  const user = actor.kind === "user" ? actor.user : actor.delegatedUser;
  if (!user) return c.redirect("/");
  const context: MailRequestContext = {
    actor,
    accessSubject: c.get("accessSubject"),
    requestId: c.req.header("x-request-id") ?? null,
  };
  const view = mailFocusViewSchema.catch("mine").parse(c.req.query("view"));
  const result = await mailboxes.listMailboxes(context, 200);
  const list = result.ok
    ? result.data.filter((mailbox): mailbox is typeof mailbox & { permission: "read" | "write" | "admin" } => mailbox.permission !== "none")
    : [];
  const publicMailboxes = await projectSsrMailboxList(list);
  if (c.req.query("recent") === "true") {
    const lastMailboxId = readMailWorkspacePreferences(c.req.header("cookie")).lastMailboxId;
    if (lastMailboxId && publicMailboxes.some((mailbox) => mailbox.id === lastMailboxId)) {
      return c.redirect(`/app/mail/${lastMailboxId}`);
    }
  }
  const deletedResult = await mailboxes.listDeletedMailboxes(context, { limit: 200 });
  const deletedMailboxes = await projectSsrMailboxList(deletedResult.ok ? deletedResult.data.items : []);
  const focusResult = await focus.listFocusConversations({ context, view });
  const initialFocus = focusResult.ok
    ? { ...focusResult.data, items: await projectSsrFocusItems(focusResult.data.items) }
    : { items: [], counts: { mine: 0, unassigned: 0, waiting: 0, all: 0 }, nextCursor: null };
  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Mail" }]}>
      <MailOverview
        mailboxes={publicMailboxes}
        deletedMailboxes={deletedMailboxes}
        initialDeletedCursor={deletedResult.ok ? deletedResult.data.nextCursor : null}
        initialFocus={initialFocus}
        initialView={view}
        currentUserEmail={user.mail}
        dateConfig={getDateConfig(c)}
      />
    </Layout>
  );
});
