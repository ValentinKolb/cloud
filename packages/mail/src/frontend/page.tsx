import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import { mailHelp } from "../help";
import type { MailRequestContext } from "../service";
import { mailboxes } from "../service";
import MailLayoutHelp from "./_components/help/MailLayoutHelp.island";
import MailOverview from "./MailOverview.island";

export default ssr<AuthContext>(async (c) => {
  const actor = c.get("actor");
  const user = actor.kind === "user" ? actor.user : actor.delegatedUser;
  if (!user) return c.redirect("/");
  const context: MailRequestContext = {
    actor,
    accessSubject: c.get("accessSubject"),
    requestId: c.req.header("x-request-id") ?? null,
  };
  const result = await mailboxes.listMailboxes(context, 200);
  const deletedResult = await mailboxes.listDeletedMailboxes(context, { limit: 200 });
  const list = result.ok
    ? result.data.filter((mailbox): mailbox is typeof mailbox & { permission: "read" | "write" | "admin" } => mailbox.permission !== "none")
    : [];
  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Mail" }]}>
      <MailLayoutHelp documents={mailHelp.manifest} />
      <MailOverview
        mailboxes={list}
        deletedMailboxes={deletedResult.ok ? deletedResult.data.items : []}
        initialDeletedCursor={deletedResult.ok ? deletedResult.data.nextCursor : null}
        initialQuery={c.req.query("q") ?? ""}
        currentUserEmail={user.mail}
      />
    </Layout>
  );
});
