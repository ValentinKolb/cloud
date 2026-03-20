import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import { settingsService } from "@/settings/service";
import SettingsForm from "../../settings/frontend/SettingsForm.island";

export default ssr<AuthContext>(async (c) => {
  const entries = (await settingsService.entry.list({ filter: { group: "files" } })).items;

  return (
    <AdminLayout c={c} title="Files" fullHeight>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-files-title">
            <h1 class="text-base font-semibold text-primary">Files</h1>
            <p class="mt-1 text-xs text-dimmed">Storage defaults and file system integration.</p>
          </div>

          <div class="info-block-info p-4 text-xs flex items-start gap-2" style="view-transition-name: admin-files-info">
            <i class="ti ti-info-circle shrink-0 mt-0.5" />
            <p>
              The file manager uses <strong>Filegate</strong> as its storage backend. Base paths define where user home directories and group
              shared directories are stored on the filesystem. Permissions use Unix octal notation such as `700` or `2770`.
            </p>
          </div>

          <div class="paper overflow-hidden" style="view-transition-name: admin-files-settings">
            <SettingsForm entries={entries} />
          </div>
        </div>
      </div>
    </AdminLayout>
  );
});
