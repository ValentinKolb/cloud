import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import SettingsForm from "./SettingsForm.island";

export default ssr<AuthContext>(async (c) => {
  return (
    <AdminLayout c={c} title="Settings">
      <div class="max-w-5xl mx-auto flex flex-col gap-4">
        <SettingsForm groups={["app", "freeipa", "user", "mail", "security"]} />
      </div>
    </AdminLayout>
  );
});
