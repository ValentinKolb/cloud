import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../../config";
import { mailHelp } from "../../../help";
import type { MailRequestContext } from "../../../service";
import { loadMailAutomationWorkspace } from "../../../service/automation-workspace";
import MailLayoutHelp from "../../_components/help/MailLayoutHelp.island";
import MailAutomationWorkspace from "../../MailAutomationWorkspace.island";

const sections = new Set(["overview", "automatic-replies", "workflows", "runs", "references"]);
const adminSections = new Set(["workflows", "runs", "references", "schedules"]);

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
  const result = await loadMailAutomationWorkspace(context, mailboxId);
  if (!result.ok) return c.redirect(`/app/mail/${mailboxId}`);
  const requestedSection = c.req.query("section") ?? "overview";
  const initialSection =
    sections.has(requestedSection) && (!adminSections.has(requestedSection) || result.data.advanced) ? requestedSection : "overview";

  return () => (
    <Layout
      c={c}
      fullPage
      title={[
        { title: "Start", href: "/" },
        { title: "Mail", href: "/app/mail" },
        { title: result.data.mailbox.name, href: `/app/mail/${mailboxId}` },
        { title: "Automations" },
      ]}
    >
      <MailLayoutHelp documents={mailHelp.manifest} />
      <MailAutomationWorkspace data={result.data} initialSection={initialSection} currentUserEmail={user.mail} />
    </Layout>
  );
});
