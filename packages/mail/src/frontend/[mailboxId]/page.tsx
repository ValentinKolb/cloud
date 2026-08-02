import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { readThemeFromCookieHeader } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import type { MailRequestContext } from "../../service";
import { loadMailboxPageData } from "../../service/workspace";
import { readMailUserPreferencesFromCookieHeader } from "../_components/mail-user-preferences";
import { readMailWorkspacePreferences } from "../_components/mail-workspace-preferences";
import MailWorkspace from "../MailWorkspace.island";

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
  const cookieHeader = c.req.header("cookie");
  const workspacePreferences = readMailWorkspacePreferences(cookieHeader);
  const userPreferences = readMailUserPreferencesFromCookieHeader(cookieHeader, mailboxId);
  const theme = readThemeFromCookieHeader(cookieHeader);
  const data = await loadMailboxPageData({ context, mailboxId, requestUrl, listMode: workspacePreferences.listMode });
  if (!data) return c.redirect("/app/mail");
  const dateConfig = getDateConfig(c);

  return () => (
    <Layout
      c={c}
      fullPage
      workspaceSidebarCollapsible={false}
      title={[{ title: "Start", href: "/" }, { title: "Mail", href: "/app/mail" }, { title: data.mailbox.name }]}
    >
      <MailWorkspace
        data={data}
        requestUrl={requestUrl.toString()}
        currentUserId={user.id}
        currentUserEmail={user.mail}
        dateConfig={dateConfig}
        initialPreferences={workspacePreferences}
        initialUserPreferences={userPreferences}
        initialTheme={theme}
      />
    </Layout>
  );
});
