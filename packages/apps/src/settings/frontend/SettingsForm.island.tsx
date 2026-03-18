import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { TextInput, NumberInput, Switch, ImageInput, TagsInput, prompts } from "@valentinkolb/cloud/lib/ui";
import { SelectInput } from "@valentinkolb/cloud/lib/ui";
import type { SettingEntry } from "@valentinkolb/cloud/core/settings";
import { GROUP_LABELS } from "@valentinkolb/cloud/core/settings";
import { apiClient } from "@/settings/client";

type SettingsResponse = { settings: SettingEntry[] };

const GROUP_ICONS: Record<string, string> = {
  app: "ti ti-app-window",
  freeipa: "ti ti-building-fortress",
  user: "ti ti-users",
  mail: "ti ti-mail",
  security: "ti ti-shield-lock",
};

const GROUP_DESCRIPTIONS: Record<string, string> = {
  app: "Public-facing identity, contact info, and scheduling.",
  freeipa: "FreeIPA connection, sync behavior, and group mapping.",
  user: "Session lifetime, account expiry, reminders, and retention.",
  mail: "SMTP delivery and email templates.",
  security: "Rate limiting and access protection.",
};

async function fetchSettings(): Promise<SettingEntry[]> {
  const res = await apiClient.index.$get();
  if (!res.ok) throw new Error("Failed to load settings");
  const data: SettingsResponse = await res.json();
  return data.settings;
}

export default function SettingsForm(props: { groups?: string[] }) {
  const [settings, { refetch }] = createResource(fetchSettings);
  const [saving, setSaving] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [edits, setEdits] = createSignal<Record<string, unknown>>({});
  const [activeGroup, setActiveGroup] = createSignal(props.groups?.[0] ?? "app");

  const getEditValue = (key: string, current: unknown): unknown => {
    const e = edits();
    return key in e ? e[key] : current;
  };

  const setEditValue = (key: string, value: unknown) => {
    setEdits((prev) => ({ ...prev, [key]: value }));
  };

  /** Save a pending edit (from inline inputs). */
  const saveSetting = async (key: string) => {
    const value = edits()[key];
    if (value === undefined) return;
    await saveSettingDirect(key, value);
  };

  /** Save a key/value pair directly to the API (used by both inline edits and modal flows). */
  const saveSettingDirect = async (key: string, value: unknown) => {
    setSaving(key);
    setError(null);
    try {
      const res = await apiClient[":key{.+}"].$put({ param: { key }, json: { value } });
      if (!res.ok) {
        const data = await res.json();
        const msg = ("message" in data && data.message) || "Failed to save";
        await prompts.error(typeof msg === "string" ? msg : "Failed to save");
        return;
      }
      setEdits((prev) => { const next = { ...prev }; delete next[key]; return next; });
      setSaved(key);
      setTimeout(() => setSaved((s) => (s === key ? null : s)), 2000);
      refetch();
    } catch {
      await prompts.error("Network error — could not save setting.");
    } finally {
      setSaving(null);
    }
  };

  const resetSetting = async (key: string) => {
    setSaving(key);
    setError(null);
    try {
      const res = await apiClient[":key{.+}"].$delete({ param: { key } });
      if (!res.ok) {
        const data = await res.json();
        setError(("message" in data && data.message) || "Failed to reset");
        return;
      }
      setEdits((prev) => { const next = { ...prev }; delete next[key]; return next; });
      setSaved(key);
      setTimeout(() => setSaved((s) => (s === key ? null : s)), 2000);
      refetch();
    } catch {
      setError("Network error");
    } finally {
      setSaving(null);
    }
  };

  const groupedSettings = createMemo(() => {
    const s = settings();
    if (!s) return [];
    const filtered = props.groups ? s.filter((entry) => props.groups!.includes(entry.group)) : s;
    const groups = new Map<string, SettingEntry[]>();
    for (const entry of filtered) {
      const list = groups.get(entry.group) ?? [];
      list.push(entry);
      groups.set(entry.group, list);
    }
    return [...groups.entries()].map(([group, entries]) => ({
      group,
      label: GROUP_LABELS[group] ?? group,
      icon: GROUP_ICONS[group] ?? "ti ti-settings",
      description: GROUP_DESCRIPTIONS[group] ?? "",
      entries,
      customCount: entries.filter((e) => e.isCustom).length,
    }));
  });

  const activeEntries = createMemo(() => groupedSettings().find((g) => g.group === activeGroup())?.entries ?? []);
  const activeLabel = createMemo(() => groupedSettings().find((g) => g.group === activeGroup())?.label ?? "");
  const activeDescription = createMemo(() => groupedSettings().find((g) => g.group === activeGroup())?.description ?? "");

  return (
    <div class="flex flex-col gap-4">
      <Show when={error()}>
        <div class="info-block-danger text-xs">{error()}</div>
      </Show>

      <Show when={settings.loading}>
        <div class="paper p-6 text-center text-sm text-dimmed">Loading settings...</div>
      </Show>

      <Show when={!settings.loading && groupedSettings().length > 0}>
        {/* Tab bar */}
        <div class="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <For each={groupedSettings()}>
            {(group) => {
              const isActive = () => activeGroup() === group.group;
              return (
                <button
                  type="button"
                  onClick={() => setActiveGroup(group.group)}
                  class={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors shrink-0 ${
                    isActive()
                      ? "bg-blue-50 text-blue-700 font-medium ring-1 ring-inset ring-blue-500/35 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-400/40"
                      : "text-dimmed hover:text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  <i class={`${group.icon} text-sm`} />
                  {group.label}
                  <Show when={group.customCount > 0}>
                    <span class="tag bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">{group.customCount}</span>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>

        {/* Active group */}
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-primary">{activeLabel()}</h2>
              <p class="text-xs text-dimmed">{activeDescription()}</p>
            </div>
            <span class="text-[10px] text-dimmed shrink-0">{activeEntries().length} settings</span>
          </div>

          <div class="paper overflow-hidden">
            <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
              <For each={activeEntries()}>
                {(entry) => (
                  <SettingRow
                    entry={entry}
                    editValue={getEditValue(entry.key, entry.value)}
                    onEdit={(v) => setEditValue(entry.key, v)}
                    onSave={() => saveSetting(entry.key)}
                    onSaveDirect={(v) => saveSettingDirect(entry.key, v)}
                    onReset={() => resetSetting(entry.key)}
                    isSaving={saving() === entry.key}
                    isSaved={saved() === entry.key}
                    hasEdit={entry.key in edits()}
                  />
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

// ── Setting Row ──

function SettingRow(props: {
  entry: SettingEntry;
  editValue: unknown;
  onEdit: (v: unknown) => void;
  onSave: () => void;
  onSaveDirect: (value: unknown) => Promise<void>;
  onReset: () => void;
  isSaving: boolean;
  isSaved: boolean;
  hasEdit: boolean;
}) {
  const entry = () => props.entry;
  const value = () => props.editValue;

  const helperLink = () => {
    const k = entry().key;
    if (k === "user.account.deleted_accounts_retention_days") return { href: "/app/accounts/deleted-accounts", label: "View deleted accounts" };
    if (k === "user.account.reminder_history_retention_days") return { href: "/app/accounts/reminders", label: "View reminder history" };
    if (k === "freeipa.user_match_mode" || k === "freeipa.account_transition_policy") return { href: "/app/accounts", label: "View accounts dashboard" };
    if (k === "user.account.ipa_expires_days" || k === "user.account.local_user_expires_days" || k === "user.account.local_guest_expires_days")
      return { href: "/app/accounts#operations", label: "Run backfill" };
    return null;
  };

  return (
    <div class="flex flex-col gap-2 px-4 py-3">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-medium text-primary">{entry().label}</span>
            <code class="text-[9px] font-mono text-dimmed">{entry().key}</code>
            <Show when={entry().isCustom}>
              <span class="tag bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">custom</span>
            </Show>
            <Show when={props.isSaved}>
              <span class="text-[10px] text-green-600 dark:text-green-400 flex items-center gap-0.5">
                <i class="ti ti-check text-[10px]" /> saved
              </span>
            </Show>
          </div>
          <div class="flex items-center gap-2 mt-0.5">
            <p class="text-[11px] text-dimmed">{entry().description}</p>
            <Show when={helperLink()}>
              {(link) => (
                <a href={link().href} class="text-[10px] text-primary hover:underline shrink-0">{link().label}</a>
              )}
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <Show when={props.hasEdit}>
            <button type="button" class="btn-sm btn-success" onClick={props.onSave} disabled={props.isSaving}>
              <Show when={props.isSaving} fallback="Save">
                <i class="ti ti-loader-2 animate-spin text-xs" />
              </Show>
            </button>
          </Show>
          <Show when={entry().isCustom}>
            <button type="button" class="btn-sm btn-danger" onClick={props.onReset} disabled={props.isSaving} title="Reset to default">
              <i class="ti ti-arrow-back-up text-xs" />
            </button>
          </Show>
        </div>
      </div>

      <SettingInput entry={entry()} value={value()} onEdit={props.onEdit} onSaveDirect={props.onSaveDirect} isSaving={props.isSaving} />
    </div>
  );
}

// ── Setting Input (by kind) ──

function SettingInput(props: { entry: SettingEntry; value: unknown; onEdit: (v: unknown) => void; onSaveDirect: (value: unknown) => Promise<void>; isSaving: boolean }) {
  const entry = () => props.entry;
  const value = () => props.value;

  if (entry().kind === "image") {
    return (
      <ImageInput
        variant="small"
        value={() => (typeof value() === "string" && (value() as string) ? (value() as string) : null)}
        onChange={(v) => props.onEdit(v ?? "")}
      />
    );
  }

  if (entry().kind === "boolean") {
    return <Switch label={value() ? "Enabled" : "Disabled"} value={() => !!value()} onChange={(v) => props.onEdit(v)} />;
  }

  if (entry().kind === "number") {
    return (
      <NumberInput
        value={() => (value() != null ? Number(value()) : 0)}
        onChange={(v) => props.onEdit(v)}
        min={entry().min}
        max={entry().max}
      />
    );
  }

  if (entry().kind === "enum") {
    return (
      <SelectInput
        value={() => (typeof value() === "string" ? (value() as string) : (entry().options?.[0]?.value ?? ""))}
        onChange={(v) => props.onEdit(v)}
        options={(entry().options ?? []).map((option) => ({ id: option.value, value: option.value, label: option.label }))}
        icon="ti ti-arrows-left-right"
      />
    );
  }

  if (entry().kind === "string_list") {
    return (
      <TagsInput
        value={() => (Array.isArray(value()) ? (value() as string[]) : [])}
        onChange={(v) => props.onEdit(v)}
        placeholder={entry().placeholder ?? entry().label}
      />
    );
  }

  if (entry().kind === "number_list") {
    return (
      <TagsInput
        value={() => (Array.isArray(value()) ? (value() as number[]).map(String) : [])}
        onChange={(v) => props.onEdit(v.map((e) => Number(e)).filter((e) => Number.isInteger(e) && e > 0))}
        placeholder={entry().placeholder ?? entry().label}
      />
    );
  }

  if (entry().kind === "template") {
    const currentValue = () => (typeof value() === "string" ? (value() as string) : "");
    const preview = () => {
      const v = currentValue();
      if (!v) return "No template configured";
      return `${v.length} chars · HTML template`;
    };

    const openEditor = async () => {
      const result = await prompts.dialog<string | undefined>(
        (close) => {
          const [draft, setDraft] = createSignal(currentValue());
          return (
            <div class="flex flex-col gap-4">
              <Show when={entry().templateVars?.length}>
                <div class="info-block-info text-xs">
                  <span class="font-medium">Available variables: </span>
                  {entry().templateVars!.map((v) => `{{${v}}}`).join(", ")}
                </div>
              </Show>
              <TextInput
                multiline
                lines={16}
                value={draft}
                onChange={setDraft}
                placeholder="HTML template..."
              />
              <div class="flex justify-end gap-2">
                <button type="button" class="btn-secondary btn-sm" onClick={() => close(undefined)}>Cancel</button>
                <button type="button" class="btn-primary btn-sm" onClick={() => close(draft())}>Save</button>
              </div>
            </div>
          );
        },
        { title: entry().label ?? "Edit Template", icon: "ti ti-template", size: "large" },
      );
      if (result !== undefined) {
        await props.onSaveDirect(result);
      }
    };

    return (
      <button type="button" class="btn-input btn-input-sm self-start" onClick={openEditor} disabled={props.isSaving}>
        <i class={props.isSaving ? "ti ti-loader-2 animate-spin text-xs" : "ti ti-pencil text-xs"} />
        Edit Template
        <span class="text-dimmed font-normal">· {preview()}</span>
      </button>
    );
  }

  if (entry().kind === "text") {
    return (
      <TextInput
        multiline
        value={() => (typeof value() === "string" ? (value() as string) : "")}
        onChange={(v) => props.onEdit(v)}
        placeholder={entry().placeholder ?? entry().label}
      />
    );
  }

  return (
    <TextInput
      value={() => (typeof value() === "string" ? (value() as string) : String(value() ?? ""))}
      onChange={(v) => props.onEdit(v)}
      placeholder={entry().placeholder ?? entry().label}
      type={entry().kind === "email" ? "email" : entry().kind === "url" ? "url" : "text"}
      password={entry().kind === "secret"}
    />
  );
}
