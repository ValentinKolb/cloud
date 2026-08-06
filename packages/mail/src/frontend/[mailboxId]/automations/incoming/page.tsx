import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../../../config";
import type { MailRequestContext } from "../../../../service";
import { loadMailIncomingAutomationsWorkspace } from "../../../../service/automation-workspace";
import type { IncomingAutomationPreset } from "../../../_components/MailIncomingAutomationSettings";
import MailIncomingAutomationsPage from "../../../MailIncomingAutomationsPage.island";

const presets = new Set<IncomingAutomationPreset>(["blank", "ai-route", "ai-tag", "ai-draft"]);

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
  const result = await loadMailIncomingAutomationsWorkspace(context, mailboxId);
  if (!result.ok) return c.redirect(`/app/mail/${mailboxId}/automations`);
  const requested = c.req.query("new") ?? "";
  const openPreset = presets.has(requested as IncomingAutomationPreset)
    ? (requested as IncomingAutomationPreset)
    : requested === "1"
      ? "blank"
      : null;
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
      <MailIncomingAutomationsPage data={result.data} currentUserEmail={user.mail} openPreset={openPreset} />
    </Layout>
  );
});
