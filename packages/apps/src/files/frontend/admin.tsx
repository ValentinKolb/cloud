import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import SettingsForm from "../../settings/frontend/SettingsForm.island";

export default ssr<AuthContext>(async (c) => {
  return (
    <AdminLayout c={c} title="Files">
      <div class="max-w-6xl mx-auto flex flex-col gap-6">
        <h1 class="text-xl font-bold text-primary">Files Settings</h1>

        <div class="info-block-info p-4 text-xs flex items-start gap-2">
          <i class="ti ti-info-circle shrink-0 mt-0.5" />
          <p>
            The file manager uses <strong>Filegate</strong> as its storage backend. Base paths define where user home directories and group
            shared directories are stored on the filesystem. Permissions use Unix octal notation (e.g. 700 = owner only, 2770 = group with
            sticky bit). Make sure the Filegate environment variables (FILEGATE_URL, etc.) are configured in your deployment.
          </p>
        </div>

        <SettingsForm groups={["files"]} />
      </div>
    </AdminLayout>
  );
});
