import { createSignal, For, Show } from "solid-js";
import { dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@valentinkolb/cloud/clients/core";
import type { ServiceAccountCredential } from "@valentinkolb/cloud/contracts";
import { CopyButton, DateTimePicker, prompts, TextInput } from "@valentinkolb/cloud/ui";

type Props = {
  initialKeys: ServiceAccountCredential[];
  surface?: "paper" | "section";
};

const presetDate = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
const hasInstantOffset = (value: string) => /[T\s].*([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
const toInstant = (value: string | null): string | null => {
  if (!value) return null;
  if (hasInstantOffset(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

function TokenDialog(props: { token: string }) {
  return (
    <div class="flex flex-col gap-4">
      <div class="info-block-warning text-xs">
        Copy this API key now. It is shown once and cannot be recovered later.
      </div>
      <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <code class="block break-all font-mono text-xs text-primary">{props.token}</code>
      </div>
      <div class="flex justify-end">
        <CopyButton text={props.token} label="Copy key" class="btn-primary btn-sm" />
      </div>
    </div>
  );
}

function ApiKeyCreateDialog(props: { close: (value: { name: string; expiresAt: string | null } | null) => void }) {
  const [name, setName] = createSignal("");
  const [expiresAt, setExpiresAt] = createSignal<string | null>(presetDate(90));
  const [error, setError] = createSignal<string | undefined>();

  const submit = () => {
    const trimmedName = name().trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    props.close({ name: trimmedName, expiresAt: toInstant(expiresAt()) });
  };

  return (
    <form
      class="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <TextInput
        label="Name"
        description="Shown in your account so you can identify where this key is used."
        placeholder="e.g. Desktop sync"
        icon="ti ti-tag"
        value={name}
        onInput={(value) => {
          setName(value);
          setError(undefined);
        }}
        error={error}
        required
      />
      <DateTimePicker
        label="Expires"
        description="Leave empty only for long-lived automation you actively maintain."
        value={expiresAt}
        onChange={setExpiresAt}
        clearable
        presets={[
          { label: "30 days", value: presetDate(30) },
          { label: "90 days", value: presetDate(90) },
          { label: "1 year", value: presetDate(365) },
          { label: "Never", value: null },
        ]}
      />
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary btn-sm" onClick={() => props.close(null)}>Cancel</button>
        <button type="submit" class="btn-primary btn-sm">
          <i class="ti ti-plus" />
          Create key
        </button>
      </div>
    </form>
  );
}

export default function ApiKeysSettings(props: Props) {
  const [keys, setKeys] = createSignal<ServiceAccountCredential[]>(props.initialKeys);
  const rootClass = () => (props.surface === "section" ? "min-w-0" : "paper p-5");

  const createMutation = mutations.create<{ credential: ServiceAccountCredential; token: string }, { name: string; expiresAt: string | null }>({
    mutation: async (vars) => {
      const res = await apiClient.me["api-keys"].$post({ json: vars });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string }).message ?? "Failed to create API key.");
      return data as { credential: ServiceAccountCredential; token: string };
    },
    onSuccess: async (data) => {
      setKeys([data.credential, ...keys()]);
      await prompts.dialog<void>(() => <TokenDialog token={data.token} />, {
        title: "API key created",
        icon: "ti ti-key",
        size: "medium",
      });
    },
    onError: (err) => prompts.error(err.message),
  });

  const revokeMutation = mutations.create<void, { id: string; name: string }, { id: string }>({
    onBefore: (vars) => ({ id: vars.id }),
    mutation: async (vars) => {
      const res = await apiClient.me["api-keys"][":id"].$delete({ param: { id: vars.id } });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to revoke API key.");
      }
    },
    onSuccess: (_, ctx) => {
      if (ctx?.id) setKeys(keys().filter((key) => key.id !== ctx.id));
    },
    onError: (err) => prompts.error(err.message),
  });

  const openCreate = async () => {
    const result = await prompts.dialog<{ name: string; expiresAt: string | null } | null>(
      (close) => <ApiKeyCreateDialog close={close} />,
      { title: "Create API key", icon: "ti ti-key", size: "medium" },
    );
    if (result) await createMutation.mutate(result);
  };

  const revoke = async (key: ServiceAccountCredential) => {
    const confirmed = await prompts.confirm(`Revoke "${key.name}"? Applications using this key will lose access immediately.`, {
      title: "Revoke API key",
      icon: "ti ti-key-off",
      variant: "danger",
      confirmText: "Revoke",
    });
    if (confirmed) await revokeMutation.mutate({ id: key.id, name: key.name });
  };

  return (
    <section class={rootClass()}>
      <div class="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 class="flex items-center gap-1.5 text-sm font-semibold text-primary">
            <i class="ti ti-key text-sm" />
            API keys
          </h2>
          <p class="mt-1 text-xs text-dimmed">Personal automation keys inherit your account permissions.</p>
        </div>
        <button type="button" class="btn-secondary btn-sm shrink-0" onClick={openCreate} disabled={createMutation.loading()}>
          <i class="ti ti-plus" />
          Add
        </button>
      </div>

      <Show
        when={keys().length > 0}
        fallback={
          <div class="rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-center dark:border-zinc-800">
            <i class="ti ti-key text-2xl text-dimmed" />
            <p class="mt-2 text-xs text-dimmed">No API keys yet.</p>
          </div>
        }
      >
        <div class="flex flex-col divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          <For each={keys()}>
            {(key) => (
              <div class="flex items-center gap-3 p-3">
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="truncate text-sm font-medium text-primary">{key.name}</span>
                    <span class="tag bg-zinc-100 text-dimmed dark:bg-zinc-800">{key.tokenPrefix}</span>
                  </div>
                  <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-dimmed">
                    <span>Created {dates.formatDate(key.createdAt)}</span>
                    <span>{key.expiresAt ? `Expires ${dates.formatDate(key.expiresAt)}` : "Never expires"}</span>
                    <span>{key.lastUsedAt ? `Used ${dates.formatDateTimeRelative(key.lastUsedAt)}` : "Never used"}</span>
                  </div>
                </div>
                <button type="button" class="btn-simple btn-sm shrink-0 text-red-600 dark:text-red-400" onClick={() => revoke(key)}>
                  <i class="ti ti-trash" />
                  Revoke
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
