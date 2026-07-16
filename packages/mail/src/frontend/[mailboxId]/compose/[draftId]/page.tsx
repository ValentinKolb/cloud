import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../../../config";
import { drafts, type MailRequestContext, mailboxAccess, mailboxes, senderIdentities } from "../../../../service";
import MailComposerPage from "../../../_components/MailComposerPage.island";

const safeReturnHref = (value: string | undefined, mailboxId: string): string =>
  value?.startsWith(`/app/mail/${mailboxId}`) ? value : `/app/mail/${mailboxId}`;

export default ssr<AuthContext>(async (c) => {
  const mailboxId = c.req.param("mailboxId") ?? "";
  const draftId = c.req.param("draftId") ?? "";
  const context: MailRequestContext = {
    actor: c.get("actor"),
    accessSubject: c.get("accessSubject"),
    requestId: c.req.header("x-request-id") ?? null,
  };
  const [mailbox, permission, identities, draft] = await Promise.all([
    mailboxes.getMailbox(context, mailboxId),
    mailboxAccess.getMailboxPermission(context, mailboxId),
    senderIdentities.listSenderIdentities(context, mailboxId),
    drafts.getDraft(context, mailboxId, draftId),
  ]);
  if (!mailbox.ok || !draft.ok || (permission !== "write" && permission !== "admin")) return c.redirect(`/app/mail/${mailboxId}`);
  const returnHref = safeReturnHref(c.req.query("return"), mailboxId);
  return () => (
    <Layout c={c} fullPage focusMode title={[{ title: "Mail", href: returnHref }, { title: draft.data.subject || "Draft" }]}>
      <MailComposerPage
        mailboxId={mailboxId}
        identities={identities.ok ? identities.data : []}
        initialDraft={draft.data}
        returnHref={returnHref}
        popout={c.req.query("window") === "1"}
      />
    </Layout>
  );
});
