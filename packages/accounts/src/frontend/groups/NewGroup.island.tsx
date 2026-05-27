import { Checkbox, CopyButton, prompts, refreshCurrentPath, TextInput } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { BaseGroup } from "@/contracts";

type ProviderChoice = "ipa" | "local";

const normalizeName = (v: string): string =>
  v
    .toLowerCase()
    .replace(/[_ ]/g, "-")
    .replace(/[^a-z0-9-]/g, "");

const PROVIDER_CARDS: Array<{
  value: ProviderChoice;
  title: string;
  eyebrow: string;
  description: string;
  icon: string;
}> = [
  {
    value: "ipa",
    title: "FreeIPA group",
    eyebrow: "Directory",
    description: "Use this for centrally managed groups. This is the right choice when the group must exist in FreeIPA.",
    icon: "ti ti-building-fortress",
  },
  {
    value: "local",
    title: "Local group",
    eyebrow: "App-managed",
    description: "Use this for app-owned access control. Local groups can include local and FreeIPA users.",
    icon: "ti ti-home-spark",
  },
];

type CreateGroupPayload = {
  provider: ProviderChoice;
  name: string;
  description?: string;
  posix?: boolean;
};

type CreateGroupResult = {
  group: BaseGroup;
  command?: string;
};

function ProviderSelectionDialog(props: { close: (provider?: ProviderChoice) => void }) {
  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <p class="text-sm font-medium text-primary">Where should this group be managed?</p>
        <p class="text-xs text-dimmed">Choose the provider first. The available options depend on that decision.</p>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        {PROVIDER_CARDS.map((provider) => (
          <button
            type="button"
            class="group flex min-h-36 flex-col items-start gap-3 rounded-2xl border border-zinc-200/80 bg-gradient-to-br from-white to-zinc-50 px-4 py-4 text-left transition hover:border-blue-300 hover:from-blue-50/70 hover:to-white dark:border-zinc-700 dark:from-zinc-950 dark:to-zinc-900 dark:hover:border-blue-700 dark:hover:from-blue-950/30 dark:hover:to-zinc-950"
            onClick={() => props.close(provider.value)}
          >
            <div class="flex items-center gap-3">
              <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700 transition group-hover:bg-blue-100 group-hover:text-blue-700 dark:bg-zinc-800 dark:text-zinc-200 dark:group-hover:bg-blue-900/40 dark:group-hover:text-blue-200">
                <i class={`${provider.icon} text-lg`} />
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-dimmed">{provider.eyebrow}</span>
                <span class="text-sm font-semibold text-primary">{provider.title}</span>
              </div>
            </div>
            <p class="text-sm leading-6 text-secondary">{provider.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateGroupDialog(props: { provider: ProviderChoice; close: (payload?: CreateGroupPayload) => void }) {
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [posix, setPosix] = createSignal(props.provider === "ipa");
  const [error, setError] = createSignal<string | undefined>(undefined);

  const handleSubmit = () => {
    const normalized = normalizeName(name());
    if (!normalized) {
      setError("Name must contain at least one alphanumeric character.");
      return;
    }

    props.close({
      provider: props.provider,
      name: normalized,
      description: description().trim() || undefined,
      posix: props.provider === "ipa" ? posix() : undefined,
    });
  };

  return (
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-1">
        <p class="text-sm font-medium text-primary">{props.provider === "ipa" ? "Create FreeIPA group" : "Create local group"}</p>
        <p class="text-xs text-dimmed">
          {props.provider === "ipa"
            ? "FreeIPA groups stay directory-backed and can optionally be POSIX-enabled for shared files."
            : "Local groups are the app-owned authorization layer and can mix local and FreeIPA users."}
        </p>
      </div>

      <Show when={props.provider === "ipa"}>
        <div class="info-block-info text-sm">
          <div class="flex items-start gap-3">
            <i class="ti ti-info-circle mt-0.5 text-base" />
            <div class="flex flex-col gap-1">
              <span class="font-medium">Directory groups are authoritative in FreeIPA.</span>
              <span class="text-xs text-blue-700/90 dark:text-blue-200/80">
                Enable POSIX only when the group also needs a shared filesystem identity.
              </span>
            </div>
          </div>
        </div>
      </Show>

      <div class="grid gap-4">
        <TextInput
          label="Name"
          required
          icon="ti ti-hash"
          value={name}
          onChange={(value) => {
            setName(value);
            if (error()) setError(undefined);
          }}
          error={error}
          placeholder="my-group"
          description="Will be normalized to lowercase with hyphens."
        />
        <TextInput
          label="Description"
          icon="ti ti-notes"
          value={description}
          onChange={setDescription}
          placeholder="Explain what this group is for"
          multiline
        />
      </div>

      <Show when={props.provider === "ipa"}>
        <Checkbox
          label="Create as POSIX group"
          description="Only POSIX groups can be used for shared filesystem access."
          value={posix}
          onChange={setPosix}
        />
      </Show>

      <div class="flex justify-end">
        <button type="button" class="btn-primary btn-sm" onClick={handleSubmit}>
          Continue
        </button>
      </div>
    </div>
  );
}

export default function NewGroup(props: { freeIpaEnabled?: boolean }) {
  const freeIpaEnabled = props.freeIpaEnabled ?? true;

  const createMutation = mutation.create<CreateGroupResult | undefined, void>({
    mutation: async () => {
      const provider = freeIpaEnabled
        ? await prompts.dialog<ProviderChoice>((close) => <ProviderSelectionDialog close={close} />, {
            title: "Choose group provider",
            icon: "ti ti-users-group",
            size: "medium",
          })
        : "local";
      if (!provider) return undefined;

      const payload = await prompts.dialog<CreateGroupPayload>((close) => <CreateGroupDialog provider={provider} close={close} />, {
        title: provider === "ipa" ? "Create FreeIPA group" : "Create local group",
        icon: provider === "ipa" ? "ti ti-building-fortress" : "ti ti-home-spark",
        size: "large",
      });
      if (!payload) return undefined;

      const confirmed = await prompts.confirm(
        <div class="flex flex-col gap-4 text-sm">
          <p>Please confirm the new group.</p>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt class="text-dimmed">Managed by</dt>
            <dd>{payload.provider === "ipa" ? "FreeIPA" : "Local"}</dd>
            <dt class="text-dimmed">Name</dt>
            <dd class="font-mono">{payload.name}</dd>
            <Show when={payload.description}>
              <dt class="text-dimmed">Description</dt>
              <dd>{payload.description}</dd>
            </Show>
            <Show when={payload.provider === "ipa"}>
              <dt class="text-dimmed">POSIX</dt>
              <dd>{payload.posix ? "Yes" : "No"}</dd>
            </Show>
          </dl>
        </div>,
        {
          title: "Confirm group creation",
          icon: "ti ti-users-group",
          confirmText: "Create group",
          size: "large",
        },
      );
      if (!confirmed) return undefined;

      const res = await apiClient.groups.$post({ json: payload });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message ?? "Failed to create group.");
      }

      const data = (await res.json()) as BaseGroup;
      return {
        group: data,
        command: data.gidnumber ? `sudo nfsctl groupadd ${data.name}` : undefined,
      };
    },
    onSuccess: async (result) => {
      if (!result) return;

      if (!result.command) {
        await prompts.success(`Group "${result.group.name}" created successfully.`, {
          title: "Group created",
          icon: "ti ti-check",
        });
        refreshCurrentPath();
        return;
      }

      const command = result.command;
      await prompts.dialog<void>(
        (close) => (
          <div class="flex flex-col gap-4">
            <div class="info-block-success text-sm">
              FreeIPA group <code class="font-mono font-semibold">{result.group.name}</code> created successfully.
            </div>
            <div class="info-block-info flex flex-col gap-3">
              <div class="flex items-center justify-between gap-3">
                <div class="flex flex-col">
                  <span class="text-sm font-medium text-primary">NFS follow-up</span>
                  <span class="text-xs text-dimmed">Run this on the NFS server.</span>
                </div>
                <CopyButton text={command} label="Copy" />
              </div>
              <pre class="overflow-x-auto whitespace-pre rounded-xl bg-white/80 px-3 py-3 text-xs font-mono text-secondary dark:bg-zinc-950/80">
                {command}
              </pre>
            </div>
            <div class="flex justify-end">
              <button
                type="button"
                class="btn-primary btn-sm"
                onClick={() => {
                  close();
                  refreshCurrentPath();
                }}
              >
                Done
              </button>
            </div>
          </div>
        ),
        { title: "Group created", icon: "ti ti-check", size: "large" },
      );
    },
    onError: (error) => prompts.error(error instanceof Error ? error.message : "Failed to create group."),
  });

  return (
    <button
      type="button"
      class="btn-input btn-input-sm shrink-0 self-stretch px-3"
      onClick={() => void createMutation.mutate(undefined)}
      disabled={createMutation.loading()}
    >
      <i class={createMutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
      <span class="hidden sm:inline">{createMutation.loading() ? "Creating..." : "New Group"}</span>
    </button>
  );
}
