import { prompts, TextInput } from "@valentinkolb/cloud/ui";
import { createMemo, createSignal, For } from "solid-js";
import { MAIL_COMMANDS, type MailProductivityCommandId } from "./mail-command-registry";
import { type MailWorkspacePreferences, normalizeMailShortcut, writeMailWorkspacePreferences } from "./mail-workspace-preferences";

const configurableCommands = MAIL_COMMANDS.filter((command) => command.defaultShortcut !== null);
const RESERVED_CLOUD_SHORTCUTS = new Map([
  ["mod+k", "Cloud search"],
  ["shift+/", "Cloud keyboard help"],
]);

export const resolveMailShortcut = (commandId: MailProductivityCommandId, preferences: MailWorkspacePreferences): string | null => {
  const override = preferences.shortcutOverrides[commandId];
  return override === undefined ? (MAIL_COMMANDS.find((command) => command.id === commandId)?.defaultShortcut ?? null) : override;
};

export const openMailShortcutSettings = async (preferences: MailWorkspacePreferences): Promise<boolean> => {
  const values = Object.fromEntries(
    configurableCommands.map((command) => [command.id, resolveMailShortcut(command.id, preferences) ?? ""]),
  ) as Record<MailProductivityCommandId, string>;

  const saved = await prompts.dialog<boolean>(
    (close) => {
      const [shortcuts, setShortcuts] = createSignal(values);
      const errors = createMemo(() => {
        const next: Partial<Record<MailProductivityCommandId, string>> = {};
        const used = new Map<string, MailProductivityCommandId>();
        for (const command of configurableCommands) {
          const raw = shortcuts()[command.id].trim();
          if (!raw) continue;
          const normalized = normalizeMailShortcut(raw);
          if (!normalized) {
            next[command.id] = "Use one key with optional Mod, Ctrl, Meta, Alt, or Shift modifiers.";
            continue;
          }
          const reserved = RESERVED_CLOUD_SHORTCUTS.get(normalized);
          if (reserved) {
            next[command.id] = `Reserved by ${reserved}.`;
            continue;
          }
          const duplicate = used.get(normalized);
          if (duplicate) {
            next[command.id] = `Already used by ${MAIL_COMMANDS.find((item) => item.id === duplicate)?.label ?? duplicate}.`;
            continue;
          }
          used.set(normalized, command.id);
        }
        return next;
      });

      const save = () => {
        if (Object.keys(errors()).length > 0) return;
        const shortcutOverrides: MailWorkspacePreferences["shortcutOverrides"] = {};
        for (const command of configurableCommands) {
          const raw = shortcuts()[command.id].trim();
          const normalized = raw ? normalizeMailShortcut(raw) : null;
          if (normalized !== command.defaultShortcut) shortcutOverrides[command.id] = normalized;
        }
        writeMailWorkspacePreferences({ ...preferences, shortcutOverrides });
        close(true);
      };

      return (
        <div class="flex min-h-0 flex-col gap-4">
          <p class="text-sm text-secondary">
            Shortcuts work outside text fields. Leave a field empty to disable that command. Changes apply after Mail reloads.
          </p>
          <div class="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
            <For each={configurableCommands}>
              {(command) => (
                <TextInput
                  name={`mail-shortcut-${command.id}`}
                  label={command.label}
                  description={command.description}
                  value={() => shortcuts()[command.id]}
                  onInput={(value) =>
                    setShortcuts((current) => ({
                      ...current,
                      [command.id]: value,
                    }))
                  }
                  error={() => errors()[command.id]}
                  placeholder={command.defaultShortcut ?? "Disabled"}
                  monospace
                  autocomplete="off"
                  maxLength={40}
                />
              )}
            </For>
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" class="btn-secondary btn-sm" onClick={() => close(false)}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" disabled={Object.keys(errors()).length > 0} onClick={save}>
              <i class="ti ti-device-floppy" aria-hidden="true" /> Save and reload
            </button>
          </div>
        </div>
      );
    },
    { title: "Keyboard shortcuts", icon: "ti ti-keyboard", size: "large" },
  );
  return saved === true;
};
