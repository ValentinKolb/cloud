import type { AuthContext } from "@valentinkolb/cloud/server";
import { coreSettings } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import { coreHelp } from "../../help";
import CoreLayoutHelp from "../CoreLayoutHelp.island";
import AccountHub, { AccountPageHeader } from "./AccountHub";
import ProfileSettings from "./ProfileSettings.island";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const freeIpaEnabled = Boolean(await coreSettings.get<boolean>("freeipa.enable"));

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Account", href: "/me" }, { title: "Preferences" }]}>
      <CoreLayoutHelp documents={coreHelp.manifest} />
      <AccountHub user={user} active="preferences">
        <div class="flex flex-col gap-2">
          <AccountPageHeader title="Preferences" description="Personal choices that affect your Cloud experience on this browser." />
          <ProfileSettings provider={user.provider} profile={user.profile} freeIpaEnabled={freeIpaEnabled} section="preferences" />
        </div>
      </AccountHub>
    </Layout>
  );
});
