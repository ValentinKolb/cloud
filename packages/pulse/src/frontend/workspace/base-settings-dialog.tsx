import { NumberInput, PermissionEditor, prompts, SettingsModal, TextInput } from "@valentinkolb/cloud/ui";
import { createSignal, type Accessor } from "solid-js";
import type { AccessEntry, Principal } from "@valentinkolb/cloud/contracts";
import type { PulseBase } from "../../contracts";
import { jsonFetch } from "./helpers";
import type { GrantableLevel } from "./types";

type BaseSettingsDialogOptions = {
  accessEntries: AccessEntry[];
  base: PulseBase;
  loading: Accessor<boolean>;
  updateBaseSettings: (
    base: PulseBase,
    input: {
      name: string;
      description: string;
      rawRetentionDays: number;
      rollupRetentionDays: number;
      sensitiveRetentionHours: number;
    },
  ) => Promise<boolean>;
  clearBaseData: () => Promise<void>;
  deleteBase: () => Promise<boolean>;
};

export const openPulseBaseSettingsDialog = (options: BaseSettingsDialogOptions) =>
  prompts.dialog<void>(
    (close) => {
      const [name, setName] = createSignal(options.base.name);
      const [description, setDescription] = createSignal(options.base.description ?? "");
      const [rawRetentionDays, setRawRetentionDays] = createSignal<number | null>(options.base.rawRetentionDays);
      const [rollupRetentionDays, setRollupRetentionDays] = createSignal<number | null>(options.base.rollupRetentionDays);
      const [sensitiveRetentionHours, setSensitiveRetentionHours] = createSignal<number | null>(options.base.sensitiveRetentionHours);
      const saveSettings = async () =>
        options.updateBaseSettings(options.base, {
          name: name(),
          description: description(),
          rawRetentionDays: rawRetentionDays() ?? options.base.rawRetentionDays,
          rollupRetentionDays: rollupRetentionDays() ?? options.base.rollupRetentionDays,
          sensitiveRetentionHours: sensitiveRetentionHours() ?? options.base.sensitiveRetentionHours,
        });

      const grantAccess = (principal: Principal, permission: GrantableLevel) =>
        jsonFetch<AccessEntry>(`/api/pulse/bases/${options.base.id}/access`, {
          method: "POST",
          body: JSON.stringify({ principal, permission }),
        });

      const updateAccess = (accessId: string, permission: GrantableLevel) =>
        jsonFetch<void>(`/api/pulse/bases/${options.base.id}/access/${accessId}`, {
          method: "PATCH",
          body: JSON.stringify({ permission }),
        });

      const revokeAccess = (accessId: string) => jsonFetch<void>(`/api/pulse/bases/${options.base.id}/access/${accessId}`, { method: "DELETE" });

      return (
        <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
          <SettingsModal title="Pulse settings" subtitle={options.base.name} icon="ti ti-activity-heartbeat" onClose={close} closeLabel="Close">
            <SettingsModal.Tab id="general" title="General" icon="ti ti-settings" description="Name and description shown across Pulse.">
              <form
                class="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveSettings();
                }}
              >
                <TextInput
                  label="Name"
                  description="Shown in the Pulse sidebar, overview, and dashboard headers."
                  icon="ti ti-tag"
                  value={name}
                  onInput={setName}
                  required
                />
                <TextInput
                  label="Description"
                  description="Optional context for teammates who can access this Pulse base."
                  icon="ti ti-align-left"
                  value={description}
                  onInput={setDescription}
                  multiline
                  lines={3}
                  placeholder="Optional"
                />
                <button type="submit" class="btn-primary btn-sm self-start" disabled={options.loading() || !name().trim()}>
                  <i class={`ti ${options.loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
                  Save
                </button>
              </form>
            </SettingsModal.Tab>

            <SettingsModal.Tab id="access" title="Access" icon="ti ti-users" description="Grant people and groups access to this Pulse base.">
              <PermissionEditor
                initialEntries={options.accessEntries}
                canEdit
                grantAccess={grantAccess}
                updateAccess={updateAccess}
                revokeAccess={revokeAccess}
                allowedLevels={[
                  { level: "read", label: "View", icon: "ti-eye" },
                  { level: "write", label: "Edit", icon: "ti-pencil" },
                  { level: "admin", label: "Manage", icon: "ti-shield" },
                ]}
              />
            </SettingsModal.Tab>

            <SettingsModal.Tab id="retention" title="Retention" icon="ti ti-clock-cog" description="Bound raw, aggregated, and sensitive telemetry independently.">
              <form
                class="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveSettings();
                }}
              >
                <NumberInput
                  label="Raw data retention"
                  description="Pulse keeps raw metrics, events, and states for this many days before cleanup."
                  icon="ti ti-clock"
                  suffix="days"
                  min={1}
                  max={3650}
                  value={rawRetentionDays}
                  onInput={setRawRetentionDays}
                  required
                />
                <NumberInput
                  label="Hourly rollup retention"
                  description="Pulse keeps hourly metric aggregates for this many days, even after raw metric samples expire."
                  icon="ti ti-chart-histogram"
                  suffix="days"
                  min={1}
                  max={3650}
                  value={rollupRetentionDays}
                  onInput={setRollupRetentionDays}
                  required
                />
                <NumberInput
                  label="Sensitive event retention"
                  description="Pulse clears classified sensitive fields after this many hours while preserving the event itself."
                  icon="ti ti-shield-lock"
                  suffix="hours"
                  min={1}
                  max={8760}
                  value={sensitiveRetentionHours}
                  onInput={setSensitiveRetentionHours}
                  required
                />
                <button type="submit" class="btn-primary btn-sm self-start" disabled={options.loading()}>
                  <i class={`ti ${options.loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
                  Save retention
                </button>
              </form>
            </SettingsModal.Tab>

            <SettingsModal.Tab
              id="danger"
              title="Danger zone"
              icon="ti ti-alert-triangle"
              tone="danger"
              description="Destructive actions for this Pulse base."
            >
              <div class="info-block-warning mb-3">
                Clearing data removes observed metrics, events, states, resources, and scrape history. Sources, API keys, dashboards, saved
                queries, access, and settings are kept.
              </div>
              <button type="button" class="btn-danger btn-sm mb-5" disabled={options.loading()} onClick={() => void options.clearBaseData()}>
                <i class="ti ti-eraser text-sm" />
                Clear all telemetry data
              </button>
              <div class="info-block-warning mb-3">
                Deleting this Pulse base removes its sources, dashboards, saved queries, metrics, events, states, and ingest keys.
              </div>
              <button
                type="button"
                class="btn-danger btn-sm"
                disabled={options.loading()}
                onClick={() => void options.deleteBase().then((deleted) => deleted && close())}
              >
                <i class="ti ti-trash text-sm" />
                Delete Pulse base
              </button>
            </SettingsModal.Tab>
          </SettingsModal>
        </div>
      );
    },
    { surface: "bare", header: false, size: "large" },
  );
