import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import { mailHelp } from "../../help";
import { type MailRequestContext, mailboxes } from "../../service";
import MailLayoutHelp from "../_components/help/MailLayoutHelp.island";
import MailComposeIntentPage from "../_components/MailComposeIntentPage.island";

export default ssr<AuthContext>(async (c) => {
  const context: MailRequestContext = {
    actor: c.get("actor"),
    accessSubject: c.get("accessSubject"),
    requestId: c.req.header("x-request-id") ?? null,
  };
  const result = await mailboxes.listMailboxes(context, 200);
  const writableMailboxes = result.ok
    ? result.data
        .filter((mailbox) => mailbox.permission === "write" || mailbox.permission === "admin")
        .map((mailbox) => ({
          id: mailbox.id,
          name: mailbox.name,
          description: mailbox.description,
        }))
    : [];
  const requestedMailboxId = c.req.query("mailbox");
  const initialMailboxId = writableMailboxes.some((mailbox) => mailbox.id === requestedMailboxId)
    ? requestedMailboxId!
    : writableMailboxes.length === 1
      ? writableMailboxes[0]!.id
      : "";

  return () => (
    <Layout c={c} fullPage focusMode title={[{ title: "Mail", href: "/app/mail" }, { title: "New message" }]}>
      <MailLayoutHelp documents={mailHelp.manifest} />
      <MailComposeIntentPage
        mailboxes={writableMailboxes}
        initialMailboxId={initialMailboxId}
        mailto={c.req.query("mailto") ?? null}
        returnHref={c.req.query("return") ?? null}
      />
    </Layout>
  );
});
