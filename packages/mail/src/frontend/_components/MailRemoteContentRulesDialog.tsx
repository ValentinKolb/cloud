import {
  dialogCore,
  PanelDialog,
  panelDialogFixedOptions,
  Placeholder,
  prompts,
  SelectInput,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { RemoteContentRuleScope } from "../../contracts";
import type { RemoteContentRule } from "../../service/remote-content";
import { readApiError } from "./api-response";

function MailRemoteContentRulesDialog(props: { mailboxId: string; close: () => void }) {
  const [rules, setRules] = createSignal<RemoteContentRule[] | null>(null);
  const [scope, setScope] = createSignal<RemoteContentRuleScope>("sender");
  const [value, setValue] = createSignal("");

  const load = mutation.create<RemoteContentRule[], void>({
    mutation: async (_input, context) => {
      const response = await apiClient.mailboxes[":mailboxId"]["remote-content-rules"].$get(
        { param: { mailboxId: props.mailboxId } },
        { init: { signal: context.abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load remote image preferences"));
      return response.json();
    },
    onSuccess: setRules,
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
    onSuccess: (rule) => {
      setRules((current) =>
        [...(current ?? []).filter((item) => item.id !== rule.id), rule].sort(
          (left, right) => left.scope.localeCompare(right.scope) || left.value.localeCompare(right.value),
        ),
      );
      setValue("");
      toast.success("Remote image preference saved");
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
    onSuccess: (id) => setRules((current) => current?.filter((rule) => rule.id !== id) ?? []),
    onError: (error) => prompts.error(error.message),
  });

  onMount(() => void load.mutate());
  onCleanup(() => {
    load.abort();
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
          <div class="info-block-note text-sm">
            Remote images can tell a sender when you opened a message. Mail blocks them unless you load them or allow a sender here.
          </div>

          <form
            class="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (value().trim()) void create.mutate();
            }}
          >
            <h3 class="text-sm font-semibold text-primary">Always load images</h3>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
              <SelectInput
                label="Match"
                value={scope}
                onChange={(next) => setScope(next as RemoteContentRuleScope)}
                options={[
                  { id: "sender", label: "Sender", icon: "ti ti-user" },
                  { id: "domain", label: "Domain", icon: "ti ti-world" },
                ]}
              />
              <TextInput
                label={scope() === "sender" ? "Email address" : "Domain"}
                placeholder={scope() === "sender" ? "name@example.com" : "example.com"}
                value={value}
                onInput={setValue}
                maxLength={320}
                required
              />
              <button type="submit" class="btn-primary btn-sm" disabled={create.loading() || !value().trim()}>
                <i class={`ti ${create.loading() ? "ti-loader-2 animate-spin" : "ti-plus"}`} aria-hidden="true" />
                Add
              </button>
            </div>
          </form>

          <Show
            when={rules()}
            fallback={
              <Show when={load.error()} fallback={<Placeholder state="loading" variant="panel" title="Loading remote image preferences" />}>
                {(error) => (
                  <Placeholder
                    state="error"
                    variant="panel"
                    title="Could not load remote image preferences"
                    description={error().message}
                    action={
                      <button type="button" class="btn-secondary btn-sm" onClick={() => void load.mutate()}>
                        Retry
                      </button>
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
                        <span class="badge badge-sm">{rule.scope === "sender" ? "Sender" : "Domain"}</span>
                        <button
                          type="button"
                          class="btn-ghost btn-icon-sm"
                          aria-label={`Remove ${rule.value}`}
                          title="Remove preference"
                          disabled={remove.loading()}
                          onClick={() => void remove.mutate(rule)}
                        >
                          <i class="ti ti-trash" aria-hidden="true" />
                        </button>
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
