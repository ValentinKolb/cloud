import { panelDialogFixedOptions } from "@valentinkolb/cloud/ui";
import type { Mailbox } from "../../contracts";
import type { MailboxAdminSettingsContext } from "../../settings-context";

export type ProviderSettingsProps = {
  mailbox: Mailbox;
  admin: MailboxAdminSettingsContext;
  currentUserEmail: string | null;
  reloading: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onReload: () => Promise<void>;
  onWorkspaceChange: () => void;
};

export const EditorHeading = (props: { title: string; description: string; onBack: () => void | Promise<void> }) => (
  <div class="flex items-start gap-2">
    <button type="button" class="icon-btn shrink-0" aria-label="Back" onClick={() => void props.onBack()}>
      <i class="ti ti-arrow-left" aria-hidden="true" />
    </button>
    <div class="min-w-0">
      <h3 class="text-sm font-semibold text-primary">{props.title}</h3>
      <p class="mt-1 text-xs text-dimmed">{props.description}</p>
    </div>
  </div>
);

export const connectionEditorDialogOptions = {
  ...panelDialogFixedOptions,
  cancelBehavior: "ignore" as const,
};
