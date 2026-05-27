import type { AuthContext } from "@valentinkolb/cloud/server";
import { coreSettings } from "@valentinkolb/cloud/services";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import FilesSettingsForm from "./_components/FilesSettingsForm.island";

export default ssr<AuthContext>(async (c) => {
  // Read current values via the typed async API. Cache-aside means subsequent
  // requests that miss Redis hit DB once, then hit Redis. Sub-millisecond.
  // `files.filegate_token` is `kind:"secret"` — never serialized into the
  // SSR'd HTML data-props. The form initializes empty; admin types a new
  // value to change, leaves empty to keep the current stored secret.
  const [filegateUrl, baseHomes, baseGroups, homeDirMode, homeFileMode, groupDirMode, groupFileMode] = await Promise.all([
    coreSettings.get<string>("files.filegate_url"),
    coreSettings.get<string>("files.base_homes"),
    coreSettings.get<string>("files.base_groups"),
    coreSettings.get<string>("files.home_dir_mode"),
    coreSettings.get<string>("files.home_file_mode"),
    coreSettings.get<string>("files.group_dir_mode"),
    coreSettings.get<string>("files.group_file_mode"),
  ]);

  return () => (
    <AdminLayout c={c} title="Files" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto" data-scroll-preserve="files-admin">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-files-title">
            <h1 class="text-base font-semibold text-primary">Files</h1>
            <p class="mt-1 text-xs text-dimmed">Storage defaults and file system integration.</p>
          </div>

          <div class="info-block-info p-4 text-xs flex items-start gap-2" style="view-transition-name: admin-files-info">
            <i class="ti ti-info-circle shrink-0 mt-0.5" />
            <p>
              The file manager uses <strong>Filegate</strong> as its storage backend. Base paths define where user home directories and
              group shared directories are stored on the filesystem. Permissions use Unix octal notation such as <code>700</code> or{" "}
              <code>2770</code>.
            </p>
          </div>

          <div class="paper overflow-hidden" style="view-transition-name: admin-files-settings">
            <FilesSettingsForm
              initial={{
                "files.filegate_url": filegateUrl ?? "",
                "files.filegate_token": "",
                "files.base_homes": baseHomes ?? "",
                "files.base_groups": baseGroups ?? "",
                "files.home_dir_mode": homeDirMode ?? "",
                "files.home_file_mode": homeFileMode ?? "",
                "files.group_dir_mode": groupDirMode ?? "",
                "files.group_file_mode": groupFileMode ?? "",
              }}
            />
          </div>
        </div>
      </div>
    </AdminLayout>
  );
});
