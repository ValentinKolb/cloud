import {
  Button,
  confirmDiscardIfDirty,
  NumberInput,
  prompts,
  SettingsField,
  SettingsGroup,
  SettingsModal,
  SettingsPanelFooter,
  TextInput,
} from "@k2b/ui";
import { PermissionEditor } from "@valentinkolb/cloud/access/ui";
import type { AccessEntry, Principal } from "@valentinkolb/cloud/contracts";
import { type Accessor, createSignal } from "solid-js";
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
      const [saved, setSaved] = createSignal({
        name: options.base.name,
        description: options.base.description ?? "",
        rawRetentionDays: options.base.rawRetentionDays,
        rollupRetentionDays: options.base.rollupRetentionDays,
        sensitiveRetentionHours: options.base.sensitiveRetentionHours,
      });
      const draft = () => ({
        name: name(),
        description: description(),
        rawRetentionDays: rawRetentionDays() ?? options.base.rawRetentionDays,
        rollupRetentionDays: rollupRetentionDays() ?? options.base.rollupRetentionDays,
        sensitiveRetentionHours: sensitiveRetentionHours() ?? options.base.sensitiveRetentionHours,
      });
      const changeCount = () => {
        const current = draft();
        const baseline = saved();
        return (Object.keys(current) as Array<keyof typeof current>).filter((key) => current[key] !== baseline[key]).length;
      };
      const discard = () => {
        const baseline = saved();
        setName(baseline.name);
        setDescription(baseline.description);
        setRawRetentionDays(baseline.rawRetentionDays);
        setRollupRetentionDays(baseline.rollupRetentionDays);
        setSensitiveRetentionHours(baseline.sensitiveRetentionHours);
      };
      const saveSettings = async () => {
        const next = draft();
        if (await options.updateBaseSettings(options.base, next)) setSaved(next);
      };

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

      const revokeAccess = (accessId: string) =>
        jsonFetch<void>(`/api/pulse/bases/${options.base.id}/access/${accessId}`, { method: "DELETE" });

      const requestClose = async () => {
        if (options.loading()) return;
        if (await confirmDiscardIfDirty(() => changeCount() > 0)) close();
      };

      return (
        <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
          <SettingsModal
            title="Pulse settings"
            subtitle={options.base.name}
            icon="ti ti-activity-heartbeat"
            onClose={() => void requestClose()}
            closeLabel="Close"
          >
            <SettingsModal.Group title="Base">
              <SettingsModal.Tab id="general" title="General" icon="ti ti-settings" description="Name and context shown across Pulse.">
                <SettingsGroup title="Identity" description="Describe this telemetry workspace for everyone who can access it.">
                  <SettingsField
                    label="Name"
                    description="Shown in the Pulse sidebar, overview, and dashboard headers."
                    error={() => (!name().trim() ? "Name is required" : undefined)}
                    changed={() => name() !== saved().name}
                  >
                    <TextInput aria-label="Name" icon="ti ti-tag" value={name} onValueChange={setName} required />
                  </SettingsField>
                  <SettingsField
                    label="Description"
                    description="Optional context for teammates who can access this Pulse base."
                    error={() => undefined}
                    changed={() => description() !== saved().description}
                  >
                    <TextInput
                      aria-label="Description"
                      icon="ti ti-align-left"
                      value={description}
                      onValueChange={setDescription}
                      multiline
                      lines={3}
                      placeholder="Optional"
                    />
                  </SettingsField>
                </SettingsGroup>
                <SettingsModal.Footer>
                  <SettingsPanelFooter
                    changeCount={changeCount}
                    loading={options.loading}
                    onDiscard={discard}
                    onSave={() => void saveSettings()}
                  />
                </SettingsModal.Footer>
              </SettingsModal.Tab>
            </SettingsModal.Group>

            <SettingsModal.Group title="Sharing">
              <SettingsModal.Tab id="access" title="Access" icon="ti ti-users" description="Permission changes save immediately.">
                <SettingsGroup title="People and groups" description="Grant view, edit, or management access to this Pulse base.">
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
                </SettingsGroup>
              </SettingsModal.Tab>
            </SettingsModal.Group>

            <SettingsModal.Group title="Data">
              <SettingsModal.Tab
                id="retention"
                title="Retention"
                icon="ti ti-clock-cog"
                description="Bound raw, aggregated, and sensitive telemetry independently."
              >
                <SettingsGroup title="Data lifecycle" description="Choose how long each class of telemetry remains available.">
                  <SettingsField
                    label="Raw data retention"
                    description="Pulse keeps raw metrics, events, and states for this many days before cleanup."
                    error={() => undefined}
                    changed={() => draft().rawRetentionDays !== saved().rawRetentionDays}
                  >
                    <NumberInput
                      aria-label="Raw data retention"
                      icon="ti ti-clock"
                      suffix="days"
                      min={1}
                      max={3650}
                      value={rawRetentionDays}
                      onValueChange={setRawRetentionDays}
                      required
                    />
                  </SettingsField>
                  <SettingsField
                    label="Hourly rollup retention"
                    description="Pulse keeps hourly aggregates after raw metric samples expire."
                    error={() => undefined}
                    changed={() => draft().rollupRetentionDays !== saved().rollupRetentionDays}
                  >
                    <NumberInput
                      aria-label="Hourly rollup retention"
                      icon="ti ti-chart-histogram"
                      suffix="days"
                      min={1}
                      max={3650}
                      value={rollupRetentionDays}
                      onValueChange={setRollupRetentionDays}
                      required
                    />
                  </SettingsField>
                  <SettingsField
                    label="Sensitive event retention"
                    description="Pulse clears classified fields after this many hours while preserving the event itself."
                    error={() => undefined}
                    changed={() => draft().sensitiveRetentionHours !== saved().sensitiveRetentionHours}
                  >
                    <NumberInput
                      aria-label="Sensitive event retention"
                      icon="ti ti-shield-lock"
                      suffix="hours"
                      min={1}
                      max={8760}
                      value={sensitiveRetentionHours}
                      onValueChange={setSensitiveRetentionHours}
                      required
                    />
                  </SettingsField>
                </SettingsGroup>
                <SettingsModal.Footer>
                  <SettingsPanelFooter
                    changeCount={changeCount}
                    loading={options.loading}
                    onDiscard={discard}
                    onSave={() => void saveSettings()}
                  />
                </SettingsModal.Footer>
              </SettingsModal.Tab>
            </SettingsModal.Group>

            <SettingsModal.Group title="Lifecycle">
              <SettingsModal.Tab
                id="danger"
                title="Danger zone"
                icon="ti ti-alert-triangle"
                tone="danger"
                description="Destructive actions for this Pulse base."
              >
                <SettingsGroup
                  title="Clear telemetry"
                  description="Remove observed metrics, events, states, resources, and scrape history while keeping configuration."
                >
                  <SettingsGroup.Action>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={options.loading()}
                      onClick={() => void options.clearBaseData()}
                    >
                      <i class="ti ti-eraser text-sm" />
                      Clear telemetry
                    </Button>
                  </SettingsGroup.Action>
                </SettingsGroup>
                <SettingsGroup
                  title="Delete Pulse base"
                  description="Permanently remove sources, dashboards, saved queries, telemetry, access, and ingest keys."
                >
                  <SettingsGroup.Action>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={options.loading()}
                      onClick={() => void options.deleteBase().then((deleted) => deleted && close())}
                    >
                      <i class="ti ti-trash text-sm" />
                      Delete Pulse base
                    </Button>
                  </SettingsGroup.Action>
                </SettingsGroup>
              </SettingsModal.Tab>
            </SettingsModal.Group>
          </SettingsModal>
        </div>
      );
    },
    { surface: "bare", header: false, size: "large" },
  );
