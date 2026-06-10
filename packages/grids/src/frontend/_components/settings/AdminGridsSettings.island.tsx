import { Placeholder, prompts } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createResource, createSignal, For, Show } from "solid-js";
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

  const saveMutation = mutations.create<boolean, void>({
    mutation: async () => {
      if (pending.size === 0) return false;
      for (const [key, value] of pending) await updateSetting(key, value);
      return true;
    },
    onSuccess: (changed) => {
      props.close();
      if (changed) refreshCurrentPath();
    },
    onError: (e) => prompts.error(e.message),
  });

  return (
    <div class="flex w-[min(24rem,calc(100vw-3rem))] max-w-full flex-col gap-4">
      <Show when={!entries.loading} fallback={<p class="text-xs text-dimmed">Loading settings…</p>}>
        <Show when={(entries() ?? []).length > 0} fallback={<Placeholder align="left" class="px-0 py-2">No Grids settings registered.</Placeholder>}>
          <div class="flex flex-col gap-3">
            <For each={entries() ?? []}>{(entry) => <SettingRow entry={entry} onChange={(value) => pending.set(entry.key, value)} />}</For>
          </div>
        </Show>
      </Show>

      <div class="flex items-center justify-end gap-2 pt-2">
        <button type="button" class="btn-input btn-input-sm" onClick={props.close} disabled={saveMutation.loading()}>
          Cancel
        </button>
        <button
          type="button"
          class="btn-input btn-input-sm"
          onClick={() => saveMutation.mutate(undefined)}
          disabled={saveMutation.loading()}
        >
          <i class={`ti ${saveMutation.loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
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
