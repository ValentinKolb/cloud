import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../../config";
import type { MailRequestContext } from "../../../service";
import { loadMailSubscriptionWorkspace } from "../../../service/subscription-workspace";
import MailSubscriptionWorkspace from "../../MailSubscriptionWorkspace.island";

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
  const initialListKey = (c.req.query("list") ?? "").trim().toLowerCase().slice(0, 4096) || null;
  const result = await loadMailSubscriptionWorkspace(context, mailboxId, initialListKey);
  if (!result.ok) return c.redirect(`/app/mail/${mailboxId}`);

  return () => (
    <Layout
      c={c}
      fullPage
      workspaceSidebarCollapsible={false}
      title={[
        { title: "Start", href: "/" },
        { title: "Mail", href: "/app/mail" },
        { title: result.data.mailbox.name, href: `/app/mail/${mailboxId}` },
        { title: "Subscriptions" },
      ]}
    >
      <MailSubscriptionWorkspace data={result.data} initialListKey={initialListKey} />
    </Layout>
  );
});
