"use client";

import { createMemo, createSignal, Show } from "solid-js";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { ImageInput, NumberInput, prompts, SelectInput, Switch, TagsInput, TextInput } from "@valentinkolb/cloud/lib/ui";
import type { SettingEntry } from "@valentinkolb/cloud/core/settings";
import { apiClient } from "@/settings/client";

const refreshCurrentPath = () => {
  window.location.href = `${window.location.pathname}${window.location.search}`;
};

const readErrorMessage = async (response: Response, fallback: string) => {
  const data = (await response.json().catch(() => null)) as { message?: string } | null;
  return data?.message ?? fallback;
};

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export default function SettingsForm(props: { entries: SettingEntry[] }) {
  return props.entries.length > 0 ? (
    <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
      {props.entries.map((entry) => (
        <SettingRow entry={entry} />
      ))}
    </div>
  ) : (
    <div class="p-6 text-center text-sm text-dimmed">No settings in this section.</div>
  );
}

function SettingRow(props: { entry: SettingEntry }) {
  const entry = () => props.entry;
  const [draft, setDraft] = createSignal<unknown>(props.entry.value);

  const changed = createMemo(() => !sameValue(draft(), props.entry.value));

  const saveMutation = mutations.create<void, unknown>({
    mutation: async (value) => {
      const response = await apiClient[":key{.+}"].$put({
        param: { key: props.entry.key },
        json: { value },
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to save setting."));
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (error) => prompts.error(error.message),
  });

  const resetMutation = mutations.create<void, void>({
    mutation: async () => {
      const response = await apiClient[":key{.+}"].$delete({
        param: { key: props.entry.key },
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to reset setting."));
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (error) => prompts.error(error.message),
  });

  const helperLink = () => {
    const key = props.entry.key;
    if (key === "user.account.deleted_accounts_retention_days") return { href: "/app/accounts/deleted-accounts", label: "Deleted accounts" };
    if (key === "user.account.reminder_history_retention_days") return { href: "/app/accounts/reminders", label: "Reminder history" };
    if (key === "freeipa.user_match_mode" || key === "freeipa.account_transition_policy") return { href: "/app/accounts", label: "Accounts admin" };
    if (key === "user.account.ipa_expires_days" || key === "user.account.local_user_expires_days" || key === "user.account.local_guest_expires_days") {
      return { href: "/app/accounts#operations", label: "Backfill tools" };
    }
    return null;
  };

  return (
    <div class="flex flex-col gap-2 px-3 py-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-medium text-primary">{entry().label}</h3>
            <code class="text-[10px] text-dimmed">{entry().key}</code>
            <Show when={entry().isCustom}>
              <span class="tag bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300">custom</span>
            </Show>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <p class="text-xs text-dimmed">{entry().description}</p>
            <Show when={helperLink()}>
              {(link) => (
                <a href={link().href} class="text-xs text-primary transition-colors hover:underline">
                  {link().label}
                </a>
              )}
            </Show>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Show when={changed()}>
            <button type="button" class="btn-success btn-sm" onClick={() => saveMutation.mutate(draft())} disabled={saveMutation.loading()}>
              <Show when={saveMutation.loading()} fallback="Save">
                <i class="ti ti-loader-2 animate-spin text-xs" />
              </Show>
            </button>
          </Show>
          <Show when={entry().isCustom}>
            <button
              type="button"
              class="btn-simple btn-sm text-red-500 hover:text-red-700"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.loading()}
              aria-label={`Reset ${entry().label}`}
            >
              <i class={resetMutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-arrow-back-up"} />
            </button>
          </Show>
        </div>
      </div>

      <SettingInput
        entry={props.entry}
        value={draft}
        onChange={setDraft}
        onSaveDirect={(value) => saveMutation.mutate(value)}
        saving={saveMutation.loading}
      />
    </div>
  );
}

function SettingInput(props: {
  entry: SettingEntry;
  value: () => unknown;
  onChange: (value: unknown) => void;
  onSaveDirect: (value: unknown) => void;
  saving: () => boolean;
}) {
  if (props.entry.kind === "image") {
    return (
      <ImageInput
        variant="small"
        value={() => (typeof props.value() === "string" && props.value() ? (props.value() as string) : null)}
        onChange={(value) => props.onChange(value ?? "")}
      />
    );
  }

  if (props.entry.kind === "boolean") {
    return <Switch label={props.value() ? "Enabled" : "Disabled"} value={() => !!props.value()} onChange={(value) => props.onChange(value)} />;
  }

  if (props.entry.kind === "number") {
    return (
      <NumberInput
        value={() => (props.value() != null ? Number(props.value()) : 0)}
        onChange={(value) => props.onChange(value)}
        min={props.entry.min}
        max={props.entry.max}
      />
    );
  }

  if (props.entry.kind === "enum") {
    return (
      <SelectInput
        value={() => (typeof props.value() === "string" ? (props.value() as string) : (props.entry.options?.[0]?.value ?? ""))}
        onChange={(value) => props.onChange(value)}
        options={(props.entry.options ?? []).map((option) => ({ id: option.value, value: option.value, label: option.label }))}
        icon="ti ti-selector"
      />
    );
  }

  if (props.entry.kind === "string_list") {
    return (
      <TagsInput
        value={() => (Array.isArray(props.value()) ? (props.value() as string[]) : [])}
        onChange={(value) => props.onChange(value)}
        placeholder={props.entry.placeholder ?? props.entry.label}
      />
    );
  }

  if (props.entry.kind === "number_list") {
    return (
      <TagsInput
        value={() => (Array.isArray(props.value()) ? (props.value() as number[]).map(String) : [])}
        onChange={(value) => props.onChange(value.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry) && entry > 0))}
        placeholder={props.entry.placeholder ?? props.entry.label}
      />
    );
  }

  if (props.entry.kind === "template") {
    const openEditor = async () => {
      const result = await prompts.dialog<string | undefined>(
        (close) => {
          const [draft, setDraft] = createSignal(typeof props.value() === "string" ? (props.value() as string) : "");
          return (
            <div class="flex flex-col gap-4">
              <Show when={props.entry.templateVars?.length}>
                <div class="info-block-info text-xs">
                  <span class="font-medium">Available variables: </span>
                  {(props.entry.templateVars ?? []).map((value) => `{{${value}}}`).join(", ")}
                </div>
              </Show>
              <TextInput multiline lines={16} value={draft} onChange={setDraft} placeholder="HTML template..." />
              <div class="flex justify-end gap-2">
                <button type="button" class="btn-secondary btn-sm" onClick={() => close(undefined)}>
                  Cancel
                </button>
                <button type="button" class="btn-primary btn-sm" onClick={() => close(draft())}>
                  Save
                </button>
              </div>
            </div>
          );
        },
        { title: props.entry.label, icon: "ti ti-template", size: "large" },
      );
      if (result !== undefined) props.onSaveDirect(result);
    };

    return (
      <button type="button" class="btn-input btn-input-sm self-start" onClick={openEditor} disabled={props.saving()}>
        <i class={props.saving() ? "ti ti-loader-2 animate-spin text-xs" : "ti ti-pencil text-xs"} />
        Edit template
      </button>
    );
  }

  if (props.entry.kind === "text") {
    return (
      <TextInput
        multiline
        value={() => (typeof props.value() === "string" ? (props.value() as string) : "")}
        onChange={(value) => props.onChange(value)}
        placeholder={props.entry.placeholder ?? props.entry.label}
      />
    );
  }

  return (
    <TextInput
      value={() => (typeof props.value() === "string" ? (props.value() as string) : String(props.value() ?? ""))}
      onChange={(value) => props.onChange(value)}
      placeholder={props.entry.placeholder ?? props.entry.label}
      type={props.entry.kind === "email" ? "email" : props.entry.kind === "url" ? "url" : "text"}
      password={props.entry.kind === "secret"}
    />
  );
}
