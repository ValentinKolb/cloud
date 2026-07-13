import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import type { MailRequestContext } from "../../service";
import MailConversationDetail from "../_components/MailConversationDetail";
import MailConversationList from "../_components/MailConversationList";
import MailSidebar from "../_components/MailSidebar";
import { loadMailboxPageData } from "./mailbox-page-data";

const rank = (permission: string): number => (permission === "admin" ? 3 : permission === "write" ? 2 : permission === "read" ? 1 : 0);

export default ssr<AuthContext>(async (c) => {
  const mailboxId = c.req.param("mailboxId") ?? "";
  if (!mailboxId) return c.redirect("/app/mail");
  const actor = c.get("actor");
  const user = actor.kind === "user" ? actor.user : actor.delegatedUser;
  if (!user) return c.redirect("/app/mail");
  const requestUrl = new URL(c.req.raw.url);
  const context: MailRequestContext = {
    actor,
    accessSubject: c.get("accessSubject"),
    requestId: c.req.header("x-request-id") ?? null,
  };
  const data = await loadMailboxPageData({ context, mailboxId, requestUrl });
  if (!data) return c.redirect("/app/mail");
  const dateConfig = getDateConfig(c);
  const canWrite = rank(data.permission) >= 2;

  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Mail", href: "/app/mail" }, { title: data.mailbox.name }]}>
      <AppWorkspace class="cloud-ui-soft">
        <MailSidebar
          mailboxId={mailboxId}
          mailboxName={data.mailbox.name}
          folders={data.folders}
          activeFolderId={data.folderId}
          activeView={data.query ? null : data.activeView}
          viewCounts={data.viewCounts}
          identities={data.identities}
          currentUserId={user.id}
          currentUserEmail={user.mail}
          permission={data.permission}
          canWrite={canWrite}
          canAdmin={rank(data.permission) >= 3}
        />
        <MailConversationList
          mailbox={data.mailbox}
          mailboxId={mailboxId}
          requestUrl={requestUrl.toString()}
          query={data.query}
          title={data.listTitle}
          items={data.listItems}
          error={data.listError}
          selectedConversationId={data.selectedConversationId}
          selectedMessageId={data.selectedMessageId}
          dateConfig={dateConfig}
        />
        <MailConversationDetail
          mailboxId={mailboxId}
          requestUrl={requestUrl.toString()}
          currentUserId={user.id}
          canWrite={canWrite}
          identities={data.identities}
          selectedConversationId={data.selectedConversationId}
          subject={data.selectedSubject}
          messages={data.detailMessages}
          collaborationState={data.collaborationState}
          comments={data.comments}
          assignableUsers={data.assignableUsers}
          collaborationError={data.collaborationError}
          dateConfig={dateConfig}
        />
      </AppWorkspace>
    </Layout>
  );
});
