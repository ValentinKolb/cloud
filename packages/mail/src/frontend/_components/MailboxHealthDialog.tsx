import { dialogCore, PanelDialog, Placeholder, panelDialogFixedOptions } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { Mailbox, MailboxOperationalHealth, ProviderBinding, ProviderConnection } from "../../contracts";
import { readApiError } from "./api-response";
import MailOperationalSettings from "./MailOperationalSettings";

type MailboxHealthData = {
  mailbox: Mailbox;
  health: MailboxOperationalHealth;
  bindings: ProviderBinding[];
  connections: ProviderConnection[];
};

function MailboxHealthDialog(props: { mailboxId: string; dateConfig: DateContext; close: () => void; onWorkspaceChange: () => void }) {
  const [data, setData] = createSignal<MailboxHealthData | null>(null);
  const load = mutation.create<MailboxHealthData, void>({
    mutation: async (_input, context) => {
      const request = { init: { signal: context.abortSignal } };
      const [mailboxResponse, healthResponse, bindingsResponse, connectionsResponse] = await Promise.all([
        apiClient.mailboxes[":mailboxId"].$get({ param: { mailboxId: props.mailboxId } }, request),
        apiClient.mailboxes[":mailboxId"].health.$get({ param: { mailboxId: props.mailboxId } }, request),
        apiClient.mailboxes[":mailboxId"].bindings.$get({ param: { mailboxId: props.mailboxId } }, request),
        apiClient.mailboxes[":mailboxId"].connections.$get({ param: { mailboxId: props.mailboxId } }, request),
      ]);
      if (!mailboxResponse.ok) throw new Error(await readApiError(mailboxResponse, "Could not load the mailbox"));
      if (!healthResponse.ok) throw new Error(await readApiError(healthResponse, "Could not load mailbox health"));
      if (!bindingsResponse.ok) throw new Error(await readApiError(bindingsResponse, "Could not load the connected account"));
      if (!connectionsResponse.ok) throw new Error(await readApiError(connectionsResponse, "Could not load provider limits"));
      return {
        mailbox: await mailboxResponse.json(),
        health: await healthResponse.json(),
        bindings: await bindingsResponse.json(),
        connections: await connectionsResponse.json(),
      };
    },
    onSuccess: setData,
  });

  const reload = async () => {
    load.abort();
    await load.mutate();
  };

  onMount(() => void reload());
  onCleanup(() => load.abort());

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Mailbox health"
        subtitle="Connection, synchronization, and repair status"
        icon="ti ti-heartbeat"
        close={props.close}
      />
      <PanelDialog.Body>
        <Show
          when={data()}
          fallback={
            <Show when={load.error()} fallback={<Placeholder state="loading" variant="panel" title="Loading mailbox health" />}>
              {(error) => (
                <Placeholder
                  state="error"
                  variant="panel"
                  title="Could not load mailbox health"
                  description={error().message}
                  action={
                    <button type="button" class="btn-secondary btn-sm" disabled={load.loading()} onClick={() => void reload()}>
                      <i class={load.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} aria-hidden="true" />
                      Retry
                    </button>
                  }
                />
              )}
            </Show>
          }
        >
          {(current) => (
            <div class="flex flex-col gap-2">
              <Show when={load.error()}>
                {(error) => (
                  <div class="info-block-danger flex items-start justify-between gap-3 text-xs" role="alert">
                    <span>{error().message}</span>
                    <button type="button" class="btn-secondary btn-sm shrink-0" disabled={load.loading()} onClick={() => void reload()}>
                      Retry
                    </button>
                  </div>
                )}
              </Show>
              <MailOperationalSettings
                mailbox={current().mailbox}
                health={current().health}
                bindings={current().bindings}
                connections={current().connections}
                dateConfig={props.dateConfig}
                reloading={load.loading()}
                onReload={reload}
                onWorkspaceChange={props.onWorkspaceChange}
              />
            </div>
          )}
        </Show>
      </PanelDialog.Body>
    </PanelDialog>
  );
}

export const openMailboxHealthDialog = async (params: {
  mailboxId: string;
  dateConfig?: DateContext;
}): Promise<{ workspaceChanged: boolean }> => {
  let workspaceChanged = false;
  await dialogCore.open<void>(
    (close) => (
      <MailboxHealthDialog
        mailboxId={params.mailboxId}
        dateConfig={params.dateConfig ?? {}}
        close={() => close()}
        onWorkspaceChange={() => {
          workspaceChanged = true;
        }}
      />
    ),
    panelDialogFixedOptions,
  );
  return { workspaceChanged };
};
