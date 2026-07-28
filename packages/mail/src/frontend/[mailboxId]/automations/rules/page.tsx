import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../../../config";
import { mailHelp } from "../../../../help";
import type { MailRequestContext } from "../../../../service";
import { loadMailSenderRulesWorkspace } from "../../../../service/automation-workspace";
import MailLayoutHelp from "../../../_components/help/MailLayoutHelp.island";
import MailSenderRulesPage from "../../../MailSenderRulesPage.island";

export default ssr<AuthContext>(async (c) => {
  const mailboxId = c.req.param("mailboxId") ?? "";
  const actor = c.get("actor");
  const user = actor.kind === "user" ? actor.user : actor.delegatedUser;
  if (!mailboxId || !user) return c.redirect("/app/mail");
  const context: MailRequestContext = {
    actor,
    accessSubject: c.get("accessSubject"),
    requestId: c.req.header("x-request-id") ?? null,
  };
  const result = await loadMailSenderRulesWorkspace(context, mailboxId);
  if (!result.ok) return c.redirect(`/app/mail/${mailboxId}/automations`);
  return () => (
    <Layout
      c={c}
      fullPage
      title={[
        { title: "Start", href: "/" },
        { title: "Mail", href: "/app/mail" },
        { title: result.data.mailbox.name, href: `/app/mail/${mailboxId}` },
        { title: "Automations", href: `/app/mail/${mailboxId}/automations` },
        { title: "Sender rules" },
      ]}
    >
      <MailLayoutHelp documents={mailHelp.manifest} />
      <MailSenderRulesPage data={result.data} currentUserEmail={user.mail} openNew={c.req.query("new") === "1"} />
    </Layout>
  );
});
