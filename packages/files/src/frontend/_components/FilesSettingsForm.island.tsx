/**
 * Bespoke admin form for files.* settings — app-files-internal island.
 *
 * Hand-coded form (8 fields) instead of dynamic dispatch. Bulk-PUTs to the
 * app's own /api/files/admin/settings endpoint.
 */

import { createMemo, createSignal } from "solid-js";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import {
  TextInput,
  prompts,
  refreshCurrentPath,
  SettingsField,
  SettingsSaveBar,
  sameSettingValue,
  readSettingsError,
  toast,
} from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";

type Initial = {
  "files.filegate_url": string;
  "files.filegate_token": string;
  "files.base_homes": string;
  "files.base_groups": string;
  "files.home_dir_mode": string;
  "files.home_file_mode": string;
  "files.group_dir_mode": string;
  "files.group_file_mode": string;
};

type Props = { initial: Initial };

export default function FilesSettingsForm(props: Props) {
  const [draft, setDraft] = createSignal<Initial>({ ...props.initial });
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({});

  const update = <K extends keyof Initial>(key: K, value: Initial[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  };

  const changedKeys = createMemo<Array<keyof Initial>>(() => {
    const d = draft();
    return (Object.keys(props.initial) as Array<keyof Initial>).filter((k) => !sameSettingValue(d[k], props.initial[k]));
  });
  const hasChanges = () => changedKeys().length > 0;

  if (typeof window !== "undefined") {
    window.onbeforeunload = () => (hasChanges() ? "" : null);
  }

  const save = mutations.create<void, void>({
    mutation: async () => {
      const updates: Record<string, string> = {};
      for (const k of changedKeys()) updates[k as string] = draft()[k];
      const response = await apiClient.admin.settings.$put({ json: updates });
      if (!response.ok) {
        const { message, fields } = await readSettingsError(response, `Save failed (HTTP ${response.status})`);
        setFieldErrors(fields);
        throw new Error(message);
      }
    },
    onSuccess: () => {
      window.onbeforeunload = null;
      toast.success("Files settings saved");
      refreshCurrentPath();
    },
    onError: (e) => prompts.error(e.message),
  });

  const discardAll = () => {
    setDraft({ ...props.initial });
    setFieldErrors({});
  };

  const isChanged = (key: keyof Initial) => !sameSettingValue(draft()[key], props.initial[key]);

  return (
    <div>
      <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
        <SettingsField
          label="Filegate URL"
          description="URL of the Filegate storage backend"
          error={() => fieldErrors()["files.filegate_url"]}
          changed={() => isChanged("files.filegate_url")}
        >
          <TextInput
            value={() => draft()["files.filegate_url"]}
            onChange={(v) => update("files.filegate_url", v)}
            placeholder="e.g. http://filegate:4000"
            type="url"
          />
        </SettingsField>

        <SettingsField
          label="Filegate Token"
          description="Authentication token for Filegate. The current value is hidden — leave empty to keep it unchanged."
          error={() => fieldErrors()["files.filegate_token"]}
          changed={() => isChanged("files.filegate_token")}
        >
          <TextInput
            value={() => draft()["files.filegate_token"]}
            onChange={(v) => update("files.filegate_token", v)}
            password
            placeholder="Leave empty to keep current value"
          />
        </SettingsField>

        <SettingsField
          label="Base Homes"
          description="Filesystem base path for user home directories"
          error={() => fieldErrors()["files.base_homes"]}
          changed={() => isChanged("files.base_homes")}
        >
          <TextInput
            value={() => draft()["files.base_homes"]}
            onChange={(v) => update("files.base_homes", v)}
            placeholder="e.g. /data/homes"
          />
        </SettingsField>

        <SettingsField
          label="Base Groups"
          description="Filesystem base path for group shared directories"
          error={() => fieldErrors()["files.base_groups"]}
          changed={() => isChanged("files.base_groups")}
        >
          <TextInput
            value={() => draft()["files.base_groups"]}
            onChange={(v) => update("files.base_groups", v)}
            placeholder="e.g. /data/groups"
          />
        </SettingsField>

        <SettingsField
          label="Home Dir Mode"
          description="Octal Unix permissions for user home directories (e.g. 700)"
          error={() => fieldErrors()["files.home_dir_mode"]}
          changed={() => isChanged("files.home_dir_mode")}
        >
          <TextInput value={() => draft()["files.home_dir_mode"]} onChange={(v) => update("files.home_dir_mode", v)} placeholder="700" />
        </SettingsField>

        <SettingsField
          label="Home File Mode"
          description="Octal Unix permissions for files in home directories (e.g. 600)"
          error={() => fieldErrors()["files.home_file_mode"]}
          changed={() => isChanged("files.home_file_mode")}
        >
          <TextInput value={() => draft()["files.home_file_mode"]} onChange={(v) => update("files.home_file_mode", v)} placeholder="600" />
        </SettingsField>

        <SettingsField
          label="Group Dir Mode"
          description="Octal Unix permissions for group directories (2770 enables SGID)"
          error={() => fieldErrors()["files.group_dir_mode"]}
          changed={() => isChanged("files.group_dir_mode")}
        >
          <TextInput value={() => draft()["files.group_dir_mode"]} onChange={(v) => update("files.group_dir_mode", v)} placeholder="2770" />
        </SettingsField>

        <SettingsField
          label="Group File Mode"
          description="Octal Unix permissions for files in group directories (e.g. 660)"
          error={() => fieldErrors()["files.group_file_mode"]}
          changed={() => isChanged("files.group_file_mode")}
        >
          <TextInput
            value={() => draft()["files.group_file_mode"]}
            onChange={(v) => update("files.group_file_mode", v)}
            placeholder="660"
          />
        </SettingsField>
      </div>

      <SettingsSaveBar
        changeCount={() => changedKeys().length}
        loading={() => save.loading()}
        onDiscard={discardAll}
        onSave={() => save.mutate()}
      />
    </div>
  );
}
