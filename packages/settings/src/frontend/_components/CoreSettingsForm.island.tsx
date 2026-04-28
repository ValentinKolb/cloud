/**
 * Core settings admin form — app-settings-internal island.
 *
 * Renders a configurable set of core settings (scoped per group: app/freeipa/...)
 * and bulk-PUTs changed entries to /api/admin/core/settings (atomic, owned by
 * core's own router).
 *
 * NOT a reusable cross-app component: knows the endpoint, knows the snapshot
 * shape, only used by app-settings's page.tsx. Other apps that have their own
 * settings build their own bespoke admin forms (DIY HTTP route + UI).
 */

import { createMemo, createSignal, Show } from "solid-js";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import {
  TextInput,
  NumberInput,
  Switch,
  ImageInput,
  TagsInput,
  SelectInput,
  prompts,
  SettingsSaveBar,
  sameSettingValue,
  readSettingsError,
} from "@valentinkolb/cloud/ui";

export type SettingFieldDef = {
  key: string;
  label: string;
  description: string;
  kind: "string" | "text" | "email" | "url" | "secret" | "image" | "boolean" | "number" | "enum" | "string_list" | "number_list" | "cron" | "timezone" | "template";
  value: unknown;
  options?: ReadonlyArray<{ value: string; label: string }>;
  min?: number;
  max?: number;
  placeholder?: string;
};

type Props = { entries: SettingFieldDef[] };

const ENDPOINT = "/api/admin/core/settings";

export default function CoreSettingsForm(props: Props) {
  const [drafts, setDrafts] = createSignal<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({});

  const initialMap = createMemo(() => {
    const m: Record<string, unknown> = {};
    for (const e of props.entries) m[e.key] = e.value;
    return m;
  });

  const valueOf = (key: string): unknown => {
    const d = drafts();
    return key in d ? d[key] : initialMap()[key];
  };

  const setDraft = (key: string, value: unknown) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  };

  const changedKeys = createMemo(() => {
    const init = initialMap();
    return Object.keys(drafts()).filter((k) => !sameSettingValue(drafts()[k], init[k]));
  });

  const hasChanges = () => changedKeys().length > 0;

  const discardAll = () => {
    setDrafts({});
    setFieldErrors({});
  };

  if (typeof window !== "undefined") {
    window.onbeforeunload = () => (hasChanges() ? "" : null);
  }

  const save = mutations.create<void, void>({
    mutation: async () => {
      const updates: Record<string, unknown> = {};
      for (const k of changedKeys()) updates[k] = drafts()[k];

      const response = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const { message, fields } = await readSettingsError(response, `Save failed (HTTP ${response.status})`);
        setFieldErrors(fields);
        throw new Error(message);
      }
    },
    onSuccess: () => {
      window.onbeforeunload = null;
      window.location.reload();
    },
    onError: (e) => prompts.error(e.message),
  });

  const reset = mutations.create<void, string>({
    mutation: async (key) => {
      const response = await fetch(`${ENDPOINT}/${encodeURIComponent(key)}`, { method: "DELETE" });
      if (!response.ok) {
        const { message } = await readSettingsError(response, "Reset failed");
        throw new Error(message);
      }
    },
    onSuccess: () => {
      window.location.reload();
    },
    onError: (e) => prompts.error(e.message),
  });

  return (
    <div>
      <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
        {props.entries.map((entry) => (
          <FieldRow
            entry={entry}
            value={() => valueOf(entry.key)}
            error={() => fieldErrors()[entry.key]}
            changed={() => !sameSettingValue(valueOf(entry.key), initialMap()[entry.key])}
            onChange={(v) => setDraft(entry.key, v)}
            onReset={() => reset.mutate(entry.key)}
            resetLoading={() => reset.loading()}
          />
        ))}
      </div>

      <SettingsSaveBar
        changeCount={() => changedKeys().length}
        loading={() => save.loading()}
        onDiscard={discardAll}
        onSave={() => save.mutate()}
      />
    </div>
  );
}

function FieldRow(props: {
  entry: SettingFieldDef;
  value: () => unknown;
  error: () => string | undefined;
  changed: () => boolean;
  onChange: (value: unknown) => void;
  onReset: () => void;
  resetLoading: () => boolean;
}) {
  const e = () => props.entry;

  return (
    <div class="flex flex-col gap-2 px-3 py-3" classList={{ "bg-amber-50/50 dark:bg-amber-950/20": props.changed() }}>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-medium text-primary">{e().label}</h3>
            <code class="text-[10px] text-dimmed">{e().key}</code>
            <Show when={props.changed()}>
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" title="Unsaved change" />
            </Show>
          </div>
          <p class="mt-1 text-xs text-dimmed">{e().description}</p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="btn-simple btn-sm text-red-500 hover:text-red-700"
            onClick={props.onReset}
            disabled={props.resetLoading()}
            aria-label={`Reset ${e().label} to default`}
            title="Reset to default"
          >
            <i class={props.resetLoading() ? "ti ti-loader-2 animate-spin" : "ti ti-arrow-back-up"} />
          </button>
        </div>
      </div>

      <FieldInput entry={e()} value={props.value} error={props.error} onChange={props.onChange} />
    </div>
  );
}

function FieldInput(props: {
  entry: SettingFieldDef;
  value: () => unknown;
  error: () => string | undefined;
  onChange: (value: unknown) => void;
}) {
  const e = props.entry;

  if (e.kind === "image") {
    return (
      <div class="flex flex-col gap-1">
        <ImageInput
          variant="small"
          value={() => (typeof props.value() === "string" && props.value() ? (props.value() as string) : null)}
          onChange={(v) => props.onChange(v ?? "")}
        />
        <Show when={props.error()}>
          <p class="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
            <i class="ti ti-alert-circle text-xs" /> {props.error()}
          </p>
        </Show>
      </div>
    );
  }

  if (e.kind === "boolean") {
    return (
      <div class="flex flex-col gap-1">
        <Switch
          label={props.value() ? "Enabled" : "Disabled"}
          value={() => Boolean(props.value())}
          onChange={(v) => props.onChange(v)}
        />
        <Show when={props.error()}>
          <p class="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
            <i class="ti ti-alert-circle text-xs" /> {props.error()}
          </p>
        </Show>
      </div>
    );
  }

  if (e.kind === "number") {
    return (
      <NumberInput
        value={() => (typeof props.value() === "number" ? (props.value() as number) : 0)}
        onChange={(v) => props.onChange(v)}
        min={e.min}
        max={e.max}
        error={props.error}
      />
    );
  }

  if (e.kind === "enum") {
    const opts = (e.options ?? []).map((o) => ({ id: o.value, value: o.value, label: o.label }));
    return (
      <SelectInput
        value={() => (typeof props.value() === "string" ? (props.value() as string) : (e.options?.[0]?.value ?? ""))}
        onChange={(v) => props.onChange(v)}
        options={opts}
        icon="ti ti-selector"
        error={props.error}
      />
    );
  }

  if (e.kind === "string_list") {
    return (
      <TagsInput
        value={() => (Array.isArray(props.value()) ? (props.value() as string[]) : [])}
        onChange={(v) => props.onChange(v)}
        placeholder={e.placeholder ?? e.label}
        error={props.error}
      />
    );
  }

  if (e.kind === "number_list") {
    return (
      <TagsInput
        value={() => (Array.isArray(props.value()) ? (props.value() as number[]).map(String) : [])}
        onChange={(v) => props.onChange(v.map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0))}
        placeholder={e.placeholder ?? e.label}
        error={props.error}
      />
    );
  }

  if (e.kind === "text" || e.kind === "template") {
    return (
      <TextInput
        multiline
        value={() => (typeof props.value() === "string" ? (props.value() as string) : "")}
        onChange={(v) => props.onChange(v)}
        placeholder={e.placeholder ?? e.label}
        error={props.error}
      />
    );
  }

  // Secrets are server-side redacted (see settings/app.ts redactSecretValue).
  // The input always starts empty; admin types a new value to change, leaves
  // empty to keep the current stored secret.
  const isSecret = e.kind === "secret";
  const secretPlaceholder = "Leave empty to keep current value";

  return (
    <TextInput
      value={() => (typeof props.value() === "string" ? (props.value() as string) : String(props.value() ?? ""))}
      onChange={(v) => props.onChange(v)}
      placeholder={isSecret ? secretPlaceholder : (e.placeholder ?? e.label)}
      type={e.kind === "email" ? "email" : e.kind === "url" ? "url" : "text"}
      password={isSecret}
      error={props.error}
    />
  );
}

