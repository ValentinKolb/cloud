import { Placeholder, prompts } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { MailboxSettingsContext } from "../../settings-context";
import { readApiError } from "./api-response";
import MailboxSettings from "./MailboxSettings";

const settingsDialogFrameClass = "flex h-[86vh] min-h-0 flex-col overflow-hidden";

type MailboxSettingsDialogOutcome = { deleted?: boolean };

export type MailboxSettingsDialogResult = {
  deleted: boolean;
  workspaceChanged: boolean;
};

type MailboxSettingsDialogProps = {
  mailboxId: string;
  currentUserId: string;
  currentUserEmail: string | null;
  close: (outcome?: MailboxSettingsDialogOutcome) => void;
  onWorkspaceChange: () => void;
};

function MailboxSettingsDialog(props: MailboxSettingsDialogProps) {
  const [context, setContext] = createSignal<MailboxSettingsContext | null>(null);
  const load = mutation.create<MailboxSettingsContext, void>({
    mutation: async (_vars, mutationContext) => {
      const response = await apiClient.mailboxes[":mailboxId"]["settings-context"].$get(
        { param: { mailboxId: props.mailboxId } },
        { init: { signal: mutationContext.abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to load mailbox settings"));
      return response.json();
    },
    onSuccess: setContext,
  });

  const reload = async () => {
    load.abort();
    await load.mutate(undefined);
  };

  onMount(() => void reload());
  onCleanup(() => load.abort());

  return (
    <Show
      when={Boolean(context())}
      fallback={
        <div class={`paper relative ${settingsDialogFrameClass} rounded-[var(--ui-radius-frame)] [box-shadow:var(--ui-shadow-float)]`}>
          <button type="button" class="icon-btn absolute right-4 top-4 z-10" aria-label="Close settings" onClick={() => props.close()}>
            <i class="ti ti-x" aria-hidden="true" />
          </button>
          <Show
            when={load.error()}
            fallback={<Placeholder state="loading" variant="panel" title="Loading mailbox settings" class="flex-1" />}
          >
            {(error) => (
              <Placeholder
                state="error"
                variant="panel"
                title="Could not load mailbox settings"
                description={error().message}
                class="flex-1"
                action={
                  <button type="button" class="btn-secondary btn-sm" disabled={load.loading()} onClick={() => void reload()}>
                    <i class={load.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} aria-hidden="true" />
                    Retry
                  </button>
                }
              />
            )}
          </Show>
        </div>
      }
    >
      <div class={settingsDialogFrameClass}>
        <MailboxSettings
          context={context()!}
          currentUserId={props.currentUserId}
          currentUserEmail={props.currentUserEmail}
          reloading={load.loading()}
          onReload={reload}
          onContextChange={(update) => setContext((current) => (current ? update(current) : current))}
          onWorkspaceChange={props.onWorkspaceChange}
          onClose={() => props.close()}
          onDeleted={() => props.close({ deleted: true })}
        />
      </div>
    </Show>
  );
}

export const openMailboxSettingsDialog = async (params: {
  mailboxId: string;
  currentUserId: string;
  currentUserEmail: string | null;
}): Promise<MailboxSettingsDialogResult> => {
  let workspaceChanged = false;
  const outcome = await prompts.dialog<MailboxSettingsDialogOutcome>(
    (close) => (
      <MailboxSettingsDialog
        {...params}
        close={close}
        onWorkspaceChange={() => {
          workspaceChanged = true;
        }}
      />
    ),
    { surface: "bare", header: false, size: "large" },
  );
  return { deleted: outcome?.deleted === true, workspaceChanged };
};
