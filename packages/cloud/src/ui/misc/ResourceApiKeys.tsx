import { dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import type { PermissionLevel, ServiceAccountCredential } from "../../contracts/shared";
import { DateTimePicker } from "../input/DatePicker";
import TextInput from "../input/TextInput";
import { prompts } from "../prompts";
import CopyButton from "./CopyButton";

type GrantablePermission = Exclude<PermissionLevel, "none">;

export type ResourceApiKey = ServiceAccountCredential & {
  permission: GrantablePermission;
};

export type ResourceApiKeyPermissionOption = {
  value: GrantablePermission;
  label: string;
  description: string;
  icon?: string;
};

type CreateResourceApiKeyInput = {
  name: string;
  expiresAt: string | null;
  permission: GrantablePermission;
};

export type ResourceApiKeysProps = {
  title?: string;
  description?: string;
  initialKeys: ResourceApiKey[];
  permissionOptions?: ResourceApiKeyPermissionOption[];
  createKey: (input: CreateResourceApiKeyInput) => Promise<{ credential: ResourceApiKey; token: string }>;
  revokeKey: (credentialId: string) => Promise<void>;
};

const DEFAULT_PERMISSIONS: ResourceApiKeyPermissionOption[] = [
  { value: "read", label: "Read", description: "Read this resource through the app API.", icon: "ti ti-eye" },
  { value: "write", label: "Write", description: "Read and update this resource through the app API.", icon: "ti ti-pencil" },
  { value: "admin", label: "Admin", description: "Manage this resource through the app API.", icon: "ti ti-shield" },
];

const presetDate = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
const hasInstantOffset = (value: string) => /[T\s].*([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
const toInstant = (value: string | null): string | null => {
  if (!value) return null;
  if (hasInstantOffset(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const permissionLabel = (permission: GrantablePermission, options: ResourceApiKeyPermissionOption[]) =>
  options.find((option) => option.value === permission)?.label ?? permission;

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

function CreateResourceApiKeyDialog(props: {
  permissionOptions: ResourceApiKeyPermissionOption[];
  close: (value: CreateResourceApiKeyInput | null) => void;
}) {
  const [name, setName] = createSignal("");
  const [permission, setPermission] = createSignal<GrantablePermission>(props.permissionOptions[0]?.value ?? "read");
  const [expiresAt, setExpiresAt] = createSignal<string | null>(presetDate(90));
  const [error, setError] = createSignal<string | undefined>();

  const submit = () => {
    const trimmedName = name().trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    props.close({ name: trimmedName, permission: permission(), expiresAt: toInstant(expiresAt()) });
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
        description="Shown in this resource so admins can identify where the key is used."
        placeholder="e.g. Website embed"
        icon="ti ti-tag"
        value={name}
        onInput={(value) => {
          setName(value);
          setError(undefined);
        }}
        error={error}
        required
      />
      <div>
        <label class="mb-1 block text-xs font-medium uppercase tracking-wide text-dimmed">Access</label>
        <div class="grid gap-2 sm:grid-cols-3">
          <For each={props.permissionOptions}>
            {(option) => (
              <button
                type="button"
                class={`rounded-lg border p-3 text-left transition-colors ${
                  permission() === option.value
                    ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-200"
                    : "border-zinc-200 bg-white text-secondary hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                }`}
                onClick={() => setPermission(option.value)}
              >
                <span class="flex items-center gap-2 text-sm font-medium">
                  <i class={option.icon ?? "ti ti-key"} />
                  {option.label}
                </span>
                <span class="mt-1 block text-xs text-dimmed">{option.description}</span>
              </button>
            )}
          </For>
        </div>
      </div>
      <DateTimePicker
        label="Expires"
        description="Leave empty only for long-lived integrations you actively maintain."
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

export default function ResourceApiKeys(props: ResourceApiKeysProps) {
  const options = () => (props.permissionOptions && props.permissionOptions.length > 0 ? props.permissionOptions : DEFAULT_PERMISSIONS);
  const [keys, setKeys] = createSignal<ResourceApiKey[]>(props.initialKeys);

  const createMutation = mutations.create<{ credential: ResourceApiKey; token: string }, CreateResourceApiKeyInput>({
    mutation: props.createKey,
    onSuccess: async (data) => {
      setKeys([data.credential, ...keys()]);
      await prompts.dialog<void>(() => <TokenDialog token={data.token} />, {
        title: "API key created",
        icon: "ti ti-key",
        size: "medium",
      });
    },
    onError: (error) => prompts.error(error.message),
  });

  const revokeMutation = mutations.create<void, { id: string; name: string }, { id: string }>({
    onBefore: (vars) => ({ id: vars.id }),
    mutation: async (vars) => props.revokeKey(vars.id),
    onSuccess: (_, ctx) => {
      if (ctx?.id) setKeys(keys().filter((key) => key.id !== ctx.id));
    },
    onError: (error) => prompts.error(error.message),
  });

  const openCreate = async () => {
    const result = await prompts.dialog<CreateResourceApiKeyInput | null>(
      (close) => <CreateResourceApiKeyDialog permissionOptions={options()} close={close} />,
      { title: "Create API key", icon: "ti ti-key", size: "medium" },
    );
    if (result) await createMutation.mutate(result);
  };

  const revoke = async (key: ResourceApiKey) => {
    const confirmed = await prompts.confirm(`Revoke "${key.name}"? Integrations using this key will lose access immediately.`, {
      title: "Revoke API key",
      icon: "ti ti-key-off",
      variant: "danger",
      confirmText: "Revoke",
    });
    if (confirmed) await revokeMutation.mutate({ id: key.id, name: key.name });
  };

  return (
    <section class="flex flex-col gap-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="flex items-center gap-1.5 text-sm font-semibold text-primary">
            <i class="ti ti-key text-sm" />
            {props.title ?? "API keys"}
          </h3>
          <p class="mt-1 text-xs text-dimmed">{props.description ?? "Resource-bound keys for app integrations."}</p>
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
                    <span class="tag bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
                      {permissionLabel(key.permission, options())}
                    </span>
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
