import type { DateContext } from "@k2b/stdlib";
import { query } from "@k2b/stdlib/solid";
import { Button, dialogCore, NoticeCard, PanelDialog, Placeholder, panelDialogFixedOptions } from "@k2b/ui";
import { Show } from "solid-js";
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
  const health = query.create<string, MailboxHealthData>({
    source: () => props.mailboxId,
    load: async (mailboxId, { abortSignal }) => {
      const request = { init: { signal: abortSignal } };
      const [mailboxResponse, healthResponse, bindingsResponse, connectionsResponse] = await Promise.all([
        apiClient.mailboxes[":mailboxId"].$get({ param: { mailboxId } }, request),
        apiClient.mailboxes[":mailboxId"].health.$get({ param: { mailboxId } }, request),
        apiClient.mailboxes[":mailboxId"].bindings.$get({ param: { mailboxId } }, request),
        apiClient.mailboxes[":mailboxId"].connections.$get({ param: { mailboxId } }, request),
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
  });

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
          when={health.data()}
          fallback={
            <Show when={health.error()} fallback={<Placeholder state="loading" variant="panel" title="Loading mailbox health" />}>
              {(error) => (
                <Placeholder
                  state="error"
                  variant="panel"
                  title="Could not load mailbox health"
                  description={error().message}
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={health.refreshing()}
                      onClick={() => void health.refresh()}
                    >
                      <i class={health.refreshing() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} aria-hidden="true" />
                      Retry
                    </Button>
                  }
                />
              )}
            </Show>
          }
        >
          {(current) => (
            <div class="flex flex-col gap-2">
              <Show when={health.error()}>
                {(error) => (
                  <NoticeCard tone="danger" icon={false} bodyClass="flex items-start justify-between gap-3" role="alert">
                    <span>{error().message}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      class="shrink-0"
                      disabled={health.refreshing()}
                      onClick={() => void health.refresh()}
                    >
                      Retry
                    </Button>
                  </NoticeCard>
                )}
              </Show>
              <MailOperationalSettings
                mailbox={current().mailbox}
                health={current().health}
                bindings={current().bindings}
                connections={current().connections}
                dateConfig={props.dateConfig}
                reloading={health.refreshing()}
                onReload={health.refresh}
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
