import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../../config";
import { type MailRequestContext, mailboxAccess, mailboxes, senderIdentities } from "../../../service";
import MailComposerPage from "../../_components/MailComposerPage.island";

export default ssr<AuthContext>(async (c) => {
  const mailboxId = c.req.param("mailboxId") ?? "";
  const context: MailRequestContext = {
    actor: c.get("actor"),
    accessSubject: c.get("accessSubject"),
    requestId: c.req.header("x-request-id") ?? null,
  };
  const [mailbox, permission, identities] = await Promise.all([
    mailboxes.getMailbox(context, mailboxId),
    mailboxAccess.getMailboxPermission(context, mailboxId),
    senderIdentities.listSenderIdentities(context, mailboxId),
  ]);
  if (!mailbox.ok || (permission !== "write" && permission !== "admin")) return c.redirect(`/app/mail/${mailboxId}`);
  const returnHref = `/app/mail/${mailboxId}`;
  return () => (
    <Layout c={c} fullPage focusMode title={[{ title: "Mail", href: returnHref }, { title: "New message" }]}>
      <MailComposerPage
        mailboxId={mailboxId}
        identities={identities.ok ? identities.data : []}
        returnHref={returnHref}
        popout={c.req.query("window") === "1"}
      />
    </Layout>
  );
});
