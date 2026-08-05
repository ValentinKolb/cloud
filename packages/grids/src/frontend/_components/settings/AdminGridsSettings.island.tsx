import { Button, dialogCore, NumberInput, PanelDialog, panelDialogOptions, Placeholder, prompts, TextInput, toast } from "@k2b/ui";
import { mutation as mutations } from "@k2b/stdlib/solid";
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

  const updateText = (next: string) => {
    setValue(next);
    props.onChange(next);
  };
  const updateNumber = (next: number | null) => {
    const raw = next === null ? "" : String(next);
    setValue(raw);
    props.onChange(next);
  };

  return (
    <Show
      when={isNumber}
      fallback={
        <TextInput
          id={`setting-${props.entry.key}`}
          label={props.entry.label}
          description={props.entry.description}
          value={value}
          onValueChange={updateText}
        />
      }
    >
      <NumberInput
        id={`setting-${props.entry.key}`}
        label={props.entry.label}
        description={props.entry.description}
        min={1}
        step={1}
        value={() => (value().trim() === "" ? null : Number(value()))}
        onValueChange={updateNumber}
        suffix={suffix ? <span class="font-mono text-xs text-dimmed">{suffix}</span> : undefined}
      />
    </Show>
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
      if (changed) toast.success("Grids settings saved");
    },
    onError: (e) => prompts.error(e.message),
  });

  return (
    <PanelDialog>
      <PanelDialog.Header title="Grids Settings" subtitle="App-level defaults used by Grids." icon="ti ti-settings" close={props.close} />
      <PanelDialog.Body>
        <PanelDialog.Section title="Settings" subtitle="Registered Grids settings and their current values." icon="ti ti-adjustments">
          <Show when={!entries.loading} fallback={<Placeholder state="loading" align="left" title="Loading settings..." />}>
            <Show
              when={(entries() ?? []).length > 0}
              fallback={<Placeholder align="left" class="px-0 py-2" description={<>No Grids settings registered.</>} />}
            >
              <div class="flex flex-col gap-3">
                <For each={entries() ?? []}>
                  {(entry) => <SettingRow entry={entry} onChange={(value) => pending.set(entry.key, value)} />}
                </For>
              </div>
            </Show>
          </Show>
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <div />
        <div class="flex items-center gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={props.close} disabled={saveMutation.loading()}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => saveMutation.mutate(undefined)}
            disabled={saveMutation.loading()}
          >
            <i class={`ti ${saveMutation.loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
            Save
          </Button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
};

const openSettingsDialog = () => dialogCore.open<void>((close) => <SettingsBody close={() => close()} />, panelDialogOptions);

export default function AdminGridsSettings() {
  return (
    <Button variant="secondary" size="sm" type="button" class="shrink-0" onClick={() => void openSettingsDialog()}>
      <i class="ti ti-settings text-sm" />
      Settings
    </Button>
  );
}
