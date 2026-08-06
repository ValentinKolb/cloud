import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../../../config";
import { mailAiAutomationKindSchema } from "../../../../contracts";
import type { MailRequestContext } from "../../../../service";
import { loadMailRulesWorkspace } from "../../../../service/automation-workspace";
import MailRulesPage from "../../../MailRulesPage.island";

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
  const result = await loadMailRulesWorkspace(context, mailboxId);
  if (!result.ok) return c.redirect(`/app/mail/${mailboxId}/automations`);
  const requestedAutomation = c.req.query("new") ?? "";
  const requestedAiKind = mailAiAutomationKindSchema.safeParse(requestedAutomation.replace(/^ai-/u, ""));
  return () => (
    <Layout
      c={c}
      fullPage
      workspaceSidebarCollapsible={false}
      title={[
        { title: "Start", href: "/" },
        { title: "Mail", href: "/app/mail" },
        { title: result.data.mailbox.name, href: `/app/mail/${mailboxId}` },
        { title: "Automations", href: `/app/mail/${mailboxId}/automations` },
        { title: "Incoming mail" },
      ]}
    >
      <MailRulesPage
        data={result.data}
        currentUserEmail={user.mail}
        openNewRule={requestedAutomation === "rule" || requestedAutomation === "1"}
        openNewAiKind={requestedAiKind.success ? requestedAiKind.data : null}
      />
    </Layout>
  );
});
