import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { For, Show, createResource, createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import { errorMessage } from "../utils/api-helpers";

type SettingEntry = {
  key: string;
  label: string;
  kind: string;
  description: string;
  default: unknown;
  value: unknown;
  isCustom: boolean;
};

const fetchSettings = async (): Promise<SettingEntry[]> => {
  const res = await apiClient.admin.settings.$get();
  if (!res.ok) throw new Error("Failed to load settings");
  return res.json();
};

const updateSetting = async (key: string, value: unknown): Promise<void> => {
  const res = await apiClient.admin.settings[":key{.+}"].$put({
    param: { key },
    json: { value },
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Failed to update setting"));
};

const unitSuffixForKey = (key: string): string | null => {
  if (key.endsWith("_mb")) return "MB";
  return null;
};

const SettingRow = (props: { entry: SettingEntry; onChange: (value: unknown) => void }) => {
  const initial = props.entry.value ?? props.entry.default ?? "";
  const [value, setValue] = createSignal(typeof initial === "string" ? initial : String(initial));
  const isNumber = props.entry.kind === "number";
  const suffix = unitSuffixForKey(props.entry.key);

  const handleInput = (event: Event) => {
    const raw = (event.currentTarget as HTMLInputElement).value;
    setValue(raw);
    props.onChange(isNumber ? (raw.trim() === "" ? null : Number(raw)) : raw);
  };

  return (
    <div class="flex flex-col gap-1">
      <label class="text-xs font-medium text-primary" for={`setting-${props.entry.key}`}>
        {props.entry.label}
      </label>
      <div class="relative">
        <input
          id={`setting-${props.entry.key}`}
          type={isNumber ? "number" : "text"}
          min={isNumber ? "1" : undefined}
          step={isNumber ? "1" : undefined}
          class={`input w-full ${suffix ? "pr-12" : ""}`}
          value={value()}
          onInput={handleInput}
        />
        <Show when={suffix}>
          <span class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] font-mono text-dimmed">{suffix}</span>
        </Show>
      </div>
      <Show when={props.entry.description}>
        <p class="text-[11px] text-dimmed">{props.entry.description}</p>
      </Show>
    </div>
  );
};

const SettingsBody = (props: { close: () => void }) => {
  const [entries] = createResource(fetchSettings);
  const pending = new Map<string, unknown>();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const save = async () => {
    if (pending.size === 0) {
      props.close();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const [key, value] of pending) await updateSetting(key, value);
      props.close();
      refreshCurrentPath();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="flex w-[min(24rem,calc(100vw-3rem))] max-w-full flex-col gap-4">
      <Show when={!entries.loading} fallback={<p class="text-xs text-dimmed">Loading settings…</p>}>
        <Show when={(entries() ?? []).length > 0} fallback={<p class="text-xs text-dimmed">No Grids settings registered.</p>}>
          <div class="flex flex-col gap-3">
            <For each={entries() ?? []}>{(entry) => <SettingRow entry={entry} onChange={(value) => pending.set(entry.key, value)} />}</For>
          </div>
        </Show>
      </Show>

      <Show when={error()}>
        <p class="text-xs text-red-600 dark:text-red-400">{error()}</p>
      </Show>

      <div class="flex items-center justify-end gap-2 pt-2">
        <button type="button" class="btn-input btn-input-sm" onClick={props.close} disabled={busy()}>
          Cancel
        </button>
        <button type="button" class="btn-input btn-input-sm" onClick={() => void save()} disabled={busy()}>
          <i class={`ti ${busy() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
          Save
        </button>
      </div>
    </div>
  );
};

const openSettingsDialog = () =>
  prompts.dialog<void>((close) => <SettingsBody close={close} />, { title: "Grids Settings", icon: "ti ti-settings" });

export default function AdminGridsSettings() {
  return (
    <button type="button" class="btn-input btn-input-sm shrink-0" onClick={() => void openSettingsDialog()} title="Grids app settings">
      <i class="ti ti-settings text-sm" />
      Settings
    </button>
  );
}
