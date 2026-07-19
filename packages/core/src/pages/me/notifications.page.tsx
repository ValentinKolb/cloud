import { listApps } from "@valentinkolb/cloud";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { notifications } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import { coreHelp } from "../../help";
import CoreLayoutHelp from "../CoreLayoutHelp.island";
import AccountHub, { AccountPageHeader, AccountSubnav, notificationViews } from "./AccountHub";
import BrowserNotificationSetup from "./BrowserNotificationSetup.island";
import NotificationPreferences, { type NotificationAppMeta } from "./NotificationPreferences.island";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const [preferences, registeredApps] = await Promise.all([notifications.user.preferences.list(user.id), listApps()]);
  const apps: NotificationAppMeta[] = registeredApps.map((app) => ({ id: app.id, name: app.name, icon: app.icon }));

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Account", href: "/me" }, { title: "Notifications" }]}>
      <CoreLayoutHelp documents={coreHelp.manifest} />
      <AccountHub user={user} active="notifications">
        <div class="flex flex-col gap-2">
          <AccountPageHeader
            title="Notifications"
            description="Choose how this device and individual Cloud apps may notify you."
            actions={<AccountSubnav active="preferences" items={notificationViews} />}
          />
          <BrowserNotificationSetup />
          <NotificationPreferences initial={preferences} apps={apps} />
        </div>
      </AccountHub>
    </Layout>
  );
});
