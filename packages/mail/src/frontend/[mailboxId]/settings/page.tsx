import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../../config";
import { type MailRequestContext, mailboxAccess, mailboxes } from "../../../service";
import MailboxSettingsButton from "../../_components/MailboxSettingsButton.island";

export default ssr<AuthContext>(async (c) => {
  const mailboxId = c.req.param("mailboxId") ?? "";
  if (!mailboxId) return c.redirect("/app/mail");
  const actor = c.get("actor");
  const user = actor.kind === "user" ? actor.user : actor.delegatedUser;
  if (!user) return c.redirect(`/app/mail/${mailboxId}`);
  const context: MailRequestContext = { actor, accessSubject: c.get("accessSubject"), requestId: c.req.header("x-request-id") ?? null };
  const [mailbox, permission] = await Promise.all([
    mailboxes.getMailbox(context, mailboxId),
    mailboxAccess.getMailboxPermission(context, mailboxId),
  ]);
  if (!mailbox.ok || permission === "none") return c.redirect(`/app/mail/${mailboxId}`);
  return () => (
    <Layout
      c={c}
      fullWidth
      title={[
        { title: "Start", href: "/" },
        { title: "Mail", href: "/app/mail" },
        { title: mailbox.data.name, href: `/app/mail/${mailboxId}` },
        { title: "Settings" },
      ]}
    >
      <MailboxSettingsButton
        mailboxId={mailboxId}
        currentUserId={user.id}
        currentUserEmail={user.mail}
        permission={permission}
        autoOpen
        hideButton
        returnHref={`/app/mail/${mailboxId}`}
      />
    </Layout>
  );
});
