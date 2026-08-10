import { mutation, query } from "@k2b/stdlib/solid";
import {
  Button,
  dialogCore,
  IconButton,
  NoticeCard,
  PanelDialog,
  Placeholder,
  panelDialogFixedOptions,
  prompts,
  Select,
  StatusBadge,
  TextInput,
  toast,
} from "@k2b/ui";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { RemoteContentRuleScope } from "../../contracts";
import type { RemoteContentRule } from "../../service/remote-content";
import { readApiError } from "./api-response";

function MailRemoteContentRulesDialog(props: { mailboxId: string; close: () => void }) {
  const [scope, setScope] = createSignal<RemoteContentRuleScope>("sender");
  const [value, setValue] = createSignal("");

  const rules = query.create<string, RemoteContentRule[]>({
    source: () => props.mailboxId,
    load: async (mailboxId, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["remote-content-rules"].$get(
        { param: { mailboxId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load remote image preferences"));
      return response.json();
    },
  });

  const create = mutation.create<RemoteContentRule, void>({
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["remote-content-rules"].$post(
        {
          param: { mailboxId: props.mailboxId },
          json: { scope: scope(), value: value().trim() },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not save the remote image preference"));
      return response.json();
    },
    onSuccess: () => {
      setValue("");
      toast.success("Remote image preference saved");
      void rules.invalidate().catch((error) =>
        prompts.error(error instanceof Error ? error.message : "The preferences could not be refreshed", {
          title: "Preference saved, refresh failed",
        }),
      );
    },
    onError: (error) => prompts.error(error.message),
  });

  const remove = mutation.create<string, RemoteContentRule>({
    mutation: async (rule, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["remote-content-rules"][":ruleId"].$delete(
        { param: { mailboxId: props.mailboxId, ruleId: rule.id } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not remove the remote image preference"));
      return rule.id;
    },
    onSuccess: () =>
      void rules.invalidate().catch((error) =>
        prompts.error(error instanceof Error ? error.message : "The preferences could not be refreshed", {
          title: "Preference removed, refresh failed",
        }),
      ),
    onError: (error) => prompts.error(error.message),
  });

  onCleanup(() => {
    create.abort();
    remove.abort();
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Remote images"
        subtitle="Choose senders whose external images may load automatically"
        icon="ti ti-photo-shield"
        close={props.close}
      />
      <PanelDialog.Body>
        <div class="flex flex-col gap-5">
          <NoticeCard tone="neutral" icon={false}>
            Remote images can tell a sender when you opened a message. Mail blocks them unless you load them or allow a sender here.
          </NoticeCard>
          <Show when={rules.data() && rules.error()}>
            <NoticeCard tone="warning" icon={false}>
              The shown preferences could not be refreshed. Retry before making another change.
              <Button variant="ghost" size="xs" type="button" class="ml-2" onClick={() => void rules.refresh()}>
                Retry
              </Button>
            </NoticeCard>
          </Show>

          <form
            class="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (value().trim()) void create.mutate();
            }}
          >
            <h3 class="text-sm font-semibold text-primary">Always load images</h3>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
              <Select
                label="Match"
                value={scope}
                onValueChange={(next) => setScope(next as RemoteContentRuleScope)}
                options={[
                  { id: "sender", label: "Sender", icon: "ti ti-user" },
                  { id: "domain", label: "Domain", icon: "ti ti-world" },
                ]}
              />
              <TextInput
                label={scope() === "sender" ? "Email address" : "Domain"}
                placeholder={scope() === "sender" ? "name@example.com" : "example.com"}
                value={value}
                onValueChange={setValue}
                maxLength={320}
                required
              />
              <Button size="sm" type="submit" disabled={create.loading() || Boolean(rules.error()) || !value().trim()}>
                <i class={`ti ${create.loading() ? "ti-loader-2 animate-spin" : "ti-plus"}`} aria-hidden="true" />
                Add
              </Button>
            </div>
          </form>

          <Show
            when={rules.data()}
            fallback={
              <Show
                when={rules.error()}
                fallback={<Placeholder state="loading" variant="panel" title="Loading remote image preferences" />}
              >
                {(error) => (
                  <Placeholder
                    state="error"
                    variant="panel"
                    title="Could not load remote image preferences"
                    description={error().message}
                    action={
                      <Button variant="secondary" size="sm" type="button" onClick={() => void rules.refresh()}>
                        Retry
                      </Button>
                    }
                  />
                )}
              </Show>
            }
          >
            {(current) => (
              <Show
                when={current().length > 0}
                fallback={
                  <Placeholder
                    icon="ti ti-photo-shield"
                    title="No automatic image loading"
                    description="Remote images stay blocked until you choose to load them in a message."
                  />
                }
              >
                <div class="flex flex-col gap-1">
                  <For each={current()}>
                    {(rule) => (
                      <div class="flex min-w-0 items-center gap-3 rounded-[var(--ui-radius-control)] px-2 py-2 hover:bg-[var(--ui-hover)]">
                        <i class={`ti ${rule.scope === "sender" ? "ti-user" : "ti-world"} shrink-0 text-secondary`} aria-hidden="true" />
                        <span class="min-w-0 flex-1 truncate text-sm text-primary">{rule.value}</span>
                        <StatusBadge tone="neutral" label={rule.scope === "sender" ? "Sender" : "Domain"} icon={null} />
                        <IconButton
                          type="button"
                          size="sm"
                          label={`Remove ${rule.value}`}
                          title="Remove preference"
                          disabled={remove.loading() || Boolean(rules.error())}
                          onClick={() => void remove.mutate(rule)}
                        >
                          <i class="ti ti-trash" aria-hidden="true" />
                        </IconButton>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            )}
          </Show>
        </div>
      </PanelDialog.Body>
    </PanelDialog>
  );
}

export const openMailRemoteContentRulesDialog = async (mailboxId: string): Promise<void> => {
  await dialogCore.open<void>(
    (close) => <MailRemoteContentRulesDialog mailboxId={mailboxId} close={() => close()} />,
    panelDialogFixedOptions,
  );
};
