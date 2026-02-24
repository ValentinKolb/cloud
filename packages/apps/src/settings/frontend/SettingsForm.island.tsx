import { createSignal, createResource, For, Show } from "solid-js";
import { TextInput } from "@valentinkolb/cloud/lib/ui";
import { NumberInput } from "@valentinkolb/cloud/lib/ui";
import { Switch } from "@valentinkolb/cloud/lib/ui";
import { ImageInput } from "@valentinkolb/cloud/lib/ui";
import type { SettingEntry } from "@valentinkolb/cloud/core/settings";
import { GROUP_LABELS } from "@valentinkolb/cloud/core/settings";
import { apiClient } from "@/settings/client";

type SettingsResponse = { settings: SettingEntry[] };

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

  // Local edits tracked per key
  const [edits, setEdits] = createSignal<Record<string, unknown>>({});

  const getEditValue = (key: string, current: unknown): unknown => {
    const e = edits();
    return key in e ? e[key] : current;
  };

  const setEditValue = (key: string, value: unknown) => {
    setEdits((prev) => ({ ...prev, [key]: value }));
  };

  const saveSetting = async (key: string) => {
    const value = edits()[key];
    if (value === undefined) return;

    setSaving(key);
    setError(null);
    try {
      const res = await apiClient[":key{.+}"].$put({
        param: { key },
        json: { value },
      });
      if (!res.ok) {
        const data = await res.json();
        setError(("message" in data && data.message) || "Failed to save");
        return;
      }
      // Clear edit for this key
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setSaved(key);
      setTimeout(() => setSaved((s) => (s === key ? null : s)), 2000);
      refetch();
    } catch {
      setError("Network error");
    } finally {
      setSaving(null);
    }
  };

  const resetSetting = async (key: string) => {
    setSaving(key);
    setError(null);
    try {
      const res = await apiClient[":key{.+}"].$delete({
        param: { key },
      });
      if (!res.ok) {
        const data = await res.json();
        setError(("message" in data && data.message) || "Failed to reset");
        return;
      }
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setSaved(key);
      setTimeout(() => setSaved((s) => (s === key ? null : s)), 2000);
      refetch();
    } catch {
      setError("Network error");
    } finally {
      setSaving(null);
    }
  };

  const groupedSettings = () => {
    const s = settings();
    if (!s) return [];

    // Filter by allowed groups if specified
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
      entries,
    }));
  };

  return (
    <div class="flex flex-col gap-6">
      <Show when={error()}>
        <div class="info-block-danger">{error()}</div>
      </Show>

      <Show when={settings.loading}>
        <div class="paper p-6 text-center text-sm text-dimmed">Loading settings...</div>
      </Show>

      <For each={groupedSettings()}>
        {(group) => (
          <div class="flex flex-col gap-2">
            <h2 class="text-sm font-semibold text-secondary flex items-center gap-2">{group.label}</h2>
            <div class="paper flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
              <For each={group.entries}>
                {(entry) => (
                  <SettingRow
                    entry={entry}
                    editValue={getEditValue(entry.key, entry.value)}
                    onEdit={(v) => setEditValue(entry.key, v)}
                    onSave={() => saveSetting(entry.key)}
                    onReset={() => resetSetting(entry.key)}
                    isSaving={saving() === entry.key}
                    isSaved={saved() === entry.key}
                    hasEdit={entry.key in edits()}
                  />
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

function SettingRow(props: {
  entry: SettingEntry;
  editValue: unknown;
  onEdit: (v: unknown) => void;
  onSave: () => void;
  onReset: () => void;
  isSaving: boolean;
  isSaved: boolean;
  hasEdit: boolean;
}) {
  const entry = () => props.entry;
  const value = () => props.editValue;

  return (
    <div class="p-4 flex flex-col gap-2">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <code class="text-xs font-mono text-primary">{entry().key}</code>
            <Show when={entry().isCustom}>
              <span class="text-[10px] px-1 py-px rounded bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">custom</span>
            </Show>
            <Show when={props.isSaved}>
              <span class="text-[10px] text-green-600 dark:text-green-400">
                <i class="ti ti-check text-xs" /> saved
              </span>
            </Show>
          </div>
          <p class="text-xs text-dimmed mt-0.5">{entry().description}</p>
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
              Default
            </button>
          </Show>
        </div>
      </div>

      {/* Input based on type */}
      {entry().key === "app.logo" || entry().key === "app.favicon" ? (
        <ImageInput
          variant="small"
          value={() => (typeof value() === "string" && (value() as string) ? (value() as string) : null)}
          onChange={(v) => props.onEdit(v ?? "")}
        />
      ) : entry().type === "boolean" ? (
        <Switch label={value() ? "Enabled" : "Disabled"} value={() => !!value()} onChange={(v) => props.onEdit(v)} />
      ) : entry().type === "number" ? (
        <NumberInput value={() => (value() != null ? Number(value()) : 0)} onChange={(v) => props.onEdit(v)} min={0} />
      ) : entry().type === "template" ? (
        <div class="flex flex-col gap-1">
          <TextInput
            multiline
            value={() => (typeof value() === "string" ? (value() as string) : "")}
            onChange={(v) => props.onEdit(v)}
            placeholder="HTML template..."
          />
          <Show when={entry().templateVars?.length}>
            <p class="text-[10px] text-dimmed">
              Variables:{" "}
              {entry()
                .templateVars!.map((v) => `{{${v}}}`)
                .join(", ")}
            </p>
          </Show>
        </div>
      ) : (
        <TextInput
          value={() => (typeof value() === "string" ? (value() as string) : String(value() ?? ""))}
          onChange={(v) => props.onEdit(v)}
          placeholder={entry().placeholder ?? entry().key}
        />
      )}
    </div>
  );
}
