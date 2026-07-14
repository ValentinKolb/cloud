/**
 * Admin button for notebook-app-level settings on `/admin/notebooks`.
 *
 * Click → opens a modal that lists every setting in the `notebooks`
 * group (read from `GET /api/notebooks/admin/settings`). Each setting
 * is rendered as a labelled input picking the right widget for its
 * kind. Save submits the changed values via `PUT /admin/settings/:key`.
 *
 * Extensible by design: future settings just need a `defaults.ts`
 * entry — they auto-appear in this modal without any frontend change.
 */
import { dialogCore, PanelDialog, Placeholder, panelDialogOptions } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { createResource, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";

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
  if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
  return await res.json();
};

const updateSetting = async (key: string, value: unknown): Promise<void> => {
  const res = await apiClient.admin.settings[":key"].$put({
    param: { key },
    json: { value },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(data?.message ?? `Failed to update ${key}`);
  }
};

/** Visual unit suffix derived from the setting key. Convention beats
 *  schema for two entries — keeps the SettingEntry type generic and
 *  the modal renderer free to grow more suffixes as new settings
 *  appear. Returns `null` when no suffix applies. */
const unitSuffixForKey = (key: string): string | null => {
  if (key.endsWith("_mb")) return "MB";
  if (key.endsWith("_px")) return "px";
  return null;
};

/**
 * Renders one setting row. The input type is picked per `entry.kind`:
 *
 *  - `number` (incl. `_mb` / `_px` suffix keys) → `<input type="number">`
 *    with optional unit pill on the right edge.
 *  - everything else → text input, value round-trips as a string and
 *    the API validates per the registered SettingDef.
 *
 * Unknown kinds also fall back to text, so adding a new `kind` in
 * `defaults.ts` doesn't crash the modal — the value still flows
 * through the backend validator.
 */
const SettingRow = (props: { entry: SettingEntry; onChange: (value: unknown) => void }) => {
  const initial = props.entry.value ?? props.entry.default ?? "";
  const [value, setValue] = createSignal(typeof initial === "string" ? initial : String(initial));

  const isNumber = props.entry.kind === "number";
  const suffix = unitSuffixForKey(props.entry.key);

  const handleInput = (e: Event) => {
    const raw = (e.currentTarget as HTMLInputElement).value;
    setValue(raw);
    // For number kinds we parse before handing the value off so the
    // PUT body matches the backend validator's expectation. Empty
    // string → null (resets to default per existing service contract).
    if (isNumber) {
      const parsed = raw.trim() === "" ? null : Number(raw);
      props.onChange(parsed);
    } else {
      props.onChange(raw);
    }
  };

  return (
    <div class="flex flex-col gap-1">
      <label class="text-xs font-medium text-primary" for={`setting-${props.entry.key}`}>
        {props.entry.label}
        <span class="ml-1.5 text-[10px] text-dimmed font-normal font-mono">{props.entry.key}</span>
      </label>
      <div class="relative">
        <input
          id={`setting-${props.entry.key}`}
          type={isNumber ? "number" : "text"}
          class={`input w-full ${suffix ? "pr-12" : ""}`}
          value={value()}
          onInput={handleInput}
          placeholder={typeof props.entry.default === "string" ? props.entry.default : String(props.entry.default ?? "")}
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

  const onChange = (key: string, value: unknown) => {
    pending.set(key, value);
  };

  const onSave = async () => {
    if (pending.size === 0) {
      props.close();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const [key, value] of pending) {
        await updateSetting(key, value);
      }
      props.close();
      refreshCurrentPath();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Notebook Settings"
        subtitle="App-level defaults and maintenance actions for Notebooks."
        icon="ti ti-settings"
        close={props.close}
      />
      <PanelDialog.Body>
        <PanelDialog.Section title="Settings" subtitle="Registered Notebooks settings and their current values." icon="ti ti-adjustments">
          <Show when={!entries.loading} fallback={<p class="text-xs text-dimmed">Loading settings...</p>}>
            <Show
              when={(entries() ?? []).length > 0}
              fallback={
                <Placeholder align="left" class="px-0 py-2">
                  No notebooks-app settings registered.
                </Placeholder>
              }
            >
              <div class="flex flex-col gap-3">
                <For each={entries() ?? []}>{(entry) => <SettingRow entry={entry} onChange={(v) => onChange(entry.key, v)} />}</For>
              </div>
            </Show>
          </Show>

          <Show when={error()}>
            <p class="text-xs text-red-600 dark:text-red-400">{error()}</p>
          </Show>
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <a href="/admin/observability/jobs?search=notebooks%3Areindex" class="btn-input btn-input-sm">
          <i class="ti ti-calendar-time text-sm" />
          Reindex job
        </a>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-input btn-input-sm" onClick={props.close} disabled={busy()}>
            Cancel
          </button>
          <button type="button" class="btn-input btn-input-sm" onClick={() => void onSave()} disabled={busy()}>
            <i class={`ti ${busy() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
            Save
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
};

const openSettingsDialog = () => dialogCore.open<void>((close) => <SettingsBody close={() => close()} />, panelDialogOptions);

export default function AdminNotebooksAppSettings() {
  return (
    <button type="button" class="btn-input btn-input-sm shrink-0" onClick={() => void openSettingsDialog()} title="Notebook app settings">
      <i class="ti ti-settings text-sm" />
      Settings
    </button>
  );
}
