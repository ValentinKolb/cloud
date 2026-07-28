import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../../../config";
import { mailHelp } from "../../../../help";
import type { MailRequestContext } from "../../../../service";
import { loadMailWorkflowsWorkspace } from "../../../../service/automation-workspace";
import MailLayoutHelp from "../../../_components/help/MailLayoutHelp.island";
import MailWorkflowsPage from "../../../MailWorkflowsPage.island";

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
  const result = await loadMailWorkflowsWorkspace(context, mailboxId);
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
        { title: "Workflows" },
      ]}
    >
      <MailLayoutHelp documents={mailHelp.manifest} />
      <MailWorkflowsPage data={result.data} currentUserEmail={user.mail} openNew={c.req.query("new") === "1"} />
    </Layout>
  );
});
