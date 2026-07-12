import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../../config";
import {
  bindings,
  type MailRequestContext,
  mailboxAccess,
  mailboxes,
  messages,
  providerConnections,
  senderIdentities,
} from "../../../service";
import MailboxSettings from "../../_components/MailboxSettings.island";

export default ssr<AuthContext>(async (c) => {
  const mailboxId = c.req.param("mailboxId") ?? "";
  if (!mailboxId) return c.redirect("/app/mail");
  const actor = c.get("actor");
  const user = actor.kind === "user" ? actor.user : actor.delegatedUser;
  if (!user) return c.redirect(`/app/mail/${mailboxId}`);
  const context: MailRequestContext = { actor, accessSubject: c.get("accessSubject"), requestId: c.req.header("x-request-id") ?? null };
  const [mailbox, access, connections, providerBindings, folders, identities] = await Promise.all([
    mailboxes.getMailbox(context, mailboxId),
    mailboxAccess.listMailboxAccess(context, mailboxId),
    providerConnections.listProviderConnections(context, mailboxId),
    bindings.listProviderBindings(context, mailboxId),
    messages.listFolders(context, mailboxId),
    senderIdentities.listSenderIdentities(context, mailboxId),
  ]);
  if (!mailbox.ok || !access.ok) return c.redirect(`/app/mail/${mailboxId}`);
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
      <MailboxSettings
        mailbox={mailbox.data}
        currentUserId={user.id}
        currentUserEmail={user.mail}
        accessEntries={access.data}
        connections={connections.ok ? connections.data : []}
        bindings={providerBindings.ok ? providerBindings.data : []}
        folders={folders.ok ? folders.data : []}
        identities={identities.ok ? identities.data : []}
      />
    </Layout>
  );
});
