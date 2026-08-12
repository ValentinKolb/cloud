import {
  Button,
  confirmDiscardIfDirty,
  NoticeCard,
  prompts,
  Select,
  SettingsField,
  SettingsGroup,
  SettingsModal,
  SettingsPanelFooter,
  TextInput,
} from "@k2b/ui";
import { type Accessor, createSignal, Show } from "solid-js";
import type { PulseDashboard } from "../../contracts";
import { DASHBOARD_REFRESH_OPTIONS, refreshOptionFromConfig } from "./helpers";
import type { RefreshIntervalOption } from "./types";

type DashboardSettingsDialogOptions = {
  currentDashboard: Accessor<PulseDashboard>;
  dashboard: PulseDashboard;
  loading: Accessor<boolean>;
  updateDashboardSettings: (
    dashboard: PulseDashboard,
    input: { name: string; refreshInterval: RefreshIntervalOption },
  ) => Promise<DashboardWriteResult>;
  enablePublicLink: (dashboard: PulseDashboard, options: { copy: boolean }) => Promise<void>;
  disablePublicLink: (dashboard: PulseDashboard) => Promise<void>;
  deleteDashboard: (dashboard: PulseDashboard) => Promise<DashboardWriteResult>;
  writeBlocked: Accessor<boolean>;
};

export type DashboardWriteResult = "failed" | "persisted" | "reconciled";

export const openPulseDashboardSettingsDialog = (options: DashboardSettingsDialogOptions) =>
  prompts.dialog<void>(
    (close) => {
      const [name, setName] = createSignal(options.dashboard.name);
      const [refreshInterval, setRefreshInterval] = createSignal<RefreshIntervalOption>(refreshOptionFromConfig(options.dashboard.config));
      const [saved, setSaved] = createSignal({ name: options.dashboard.name, refreshInterval: refreshInterval() });
      const changeCount = () => Number(name() !== saved().name) + Number(refreshInterval() !== saved().refreshInterval);
      const discard = () => {
        setName(saved().name);
        setRefreshInterval(saved().refreshInterval);
      };
      const save = async () => {
        const next = { name: name(), refreshInterval: refreshInterval() };
        if ((await options.updateDashboardSettings(options.currentDashboard(), next)) !== "failed") setSaved(next);
      };
      const requestClose = async () => {
        if (!options.loading() && (await confirmDiscardIfDirty(() => changeCount() > 0))) close();
      };

      return (
        <div class="flex h-[72vh] min-h-0 flex-col overflow-hidden">
          <SettingsModal
            title="Dashboard settings"
            subtitle={options.dashboard.name}
            icon="ti ti-layout-dashboard"
            onClose={() => void requestClose()}
            closeLabel="Close"
          >
            <SettingsModal.Group title="Dashboard">
              <SettingsModal.Tab
                id="general"
                title="General"
                icon="ti ti-settings"
                description="Name and refresh behavior for this dashboard."
              >
                <SettingsGroup title="Display" description="Choose how this dashboard appears and refreshes.">
                  <SettingsField
                    label="Name"
                    description="Use a short name that describes the view or audience."
                    error={() => (!name().trim() ? "Name is required" : undefined)}
                    changed={() => name() !== saved().name}
                  >
                    <TextInput aria-label="Name" icon="ti ti-tag" value={name} onValueChange={setName} required />
                  </SettingsField>
                  <SettingsField
                    label="Auto refresh"
                    description="Choose how often Pulse refreshes this dashboard. Use never for static views."
                    error={() => undefined}
                    changed={() => refreshInterval() !== saved().refreshInterval}
                  >
                    <Select
                      aria-label="Auto refresh"
                      icon="ti ti-refresh"
                      value={refreshInterval}
                      onValueChange={(value) => setRefreshInterval(value as RefreshIntervalOption)}
                      options={DASHBOARD_REFRESH_OPTIONS}
                    />
                  </SettingsField>
                </SettingsGroup>
                <SettingsModal.Footer>
                  <SettingsPanelFooter changeCount={changeCount} loading={options.loading} onDiscard={discard} onSave={() => void save()} />
                </SettingsModal.Footer>
              </SettingsModal.Tab>
            </SettingsModal.Group>

            <SettingsModal.Group title="Sharing">
              <SettingsModal.Tab
                id="public-link"
                title="Public link"
                icon="ti ti-link"
                description="Anyone with the public link can view this dashboard's included data."
              >
                <SettingsGroup title="Public access" description="Changes apply immediately.">
                  <NoticeCard tone={options.currentDashboard().publicEnabled ? "success" : "info"} icon={false}>
                    {options.currentDashboard().publicEnabled
                      ? "Public display is enabled. Copy the link whenever you need it, or disable public access."
                      : "Public display is disabled. Create a link when you want to share this dashboard without auth."}
                  </NoticeCard>
                  <div class="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={options.loading() || options.writeBlocked()}
                      onClick={() => void options.enablePublicLink(options.currentDashboard(), { copy: true })}
                    >
                      <i class="ti ti-copy" />
                      {options.currentDashboard().publicEnabled ? "Copy public link" : "Create and copy link"}
                    </Button>
                    <Show when={options.currentDashboard().publicEnabled}>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={options.loading() || options.writeBlocked()}
                        onClick={() => void options.disablePublicLink(options.currentDashboard())}
                      >
                        <i class="ti ti-link-off" />
                        Disable public link
                      </Button>
                    </Show>
                  </div>
                </SettingsGroup>
              </SettingsModal.Tab>
            </SettingsModal.Group>

            <SettingsModal.Group title="Lifecycle">
              <SettingsModal.Tab
                id="danger"
                title="Danger zone"
                icon="ti ti-alert-triangle"
                tone="danger"
                description="Delete this dashboard."
              >
                <SettingsGroup title="Delete dashboard" description="Permanently remove this dashboard. This cannot be undone.">
                  <SettingsGroup.Action>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={options.loading() || options.writeBlocked()}
                      onClick={() => void options.deleteDashboard(options.dashboard).then((result) => result !== "failed" && close())}
                    >
                      <i class="ti ti-trash text-sm" />
                      Delete dashboard
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
