import { prompts, SelectInput, SettingsModal, TextInput } from "@valentinkolb/cloud/ui";
import { createSignal, Show, type Accessor } from "solid-js";
import type { PulseDashboard } from "../../contracts";
import { DASHBOARD_REFRESH_OPTIONS, refreshOptionFromConfig } from "./helpers";
import type { RefreshIntervalOption } from "./types";

type DashboardSettingsDialogOptions = {
  currentDashboard: Accessor<PulseDashboard>;
  dashboard: PulseDashboard;
  loading: Accessor<boolean>;
  updateDashboardSettings: (dashboard: PulseDashboard, input: { name: string; refreshInterval: RefreshIntervalOption }) => Promise<boolean>;
  enablePublicLink: (dashboard: PulseDashboard, options: { copy: boolean }) => Promise<void>;
  disablePublicLink: (dashboard: PulseDashboard) => Promise<void>;
  deleteDashboard: (dashboard: PulseDashboard) => Promise<boolean>;
};

export const openPulseDashboardSettingsDialog = (options: DashboardSettingsDialogOptions) =>
  prompts.dialog<void>(
    (close) => {
      const [name, setName] = createSignal(options.dashboard.name);
      const [refreshInterval, setRefreshInterval] = createSignal<RefreshIntervalOption>(refreshOptionFromConfig(options.dashboard.config));

      return (
        <div class="flex h-[72vh] min-h-0 flex-col overflow-hidden">
          <SettingsModal
            title="Dashboard settings"
            subtitle={options.dashboard.name}
            icon="ti ti-layout-dashboard"
            onClose={close}
            closeLabel="Close"
          >
            <SettingsModal.Tab id="general" title="General" icon="ti ti-settings" description="Name shown in the Pulse sidebar and header.">
              <form
                class="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void options.updateDashboardSettings(options.currentDashboard(), { name: name(), refreshInterval: refreshInterval() });
                }}
              >
                <TextInput
                  label="Name"
                  description="Use a short dashboard name that describes the view or audience."
                  icon="ti ti-tag"
                  value={name}
                  onInput={setName}
                  required
                />
                <SelectInput
                  label="Auto refresh"
                  description="Controls how often Pulse refreshes this dashboard in the background. Use never for static views."
                  icon="ti ti-refresh"
                  value={refreshInterval}
                  onChange={(value) => setRefreshInterval(value as RefreshIntervalOption)}
                  options={DASHBOARD_REFRESH_OPTIONS}
                />
                <button type="submit" class="btn-primary btn-sm self-start" disabled={options.loading() || !name().trim()}>
                  <i class={`ti ${options.loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
                  Save
                </button>
              </form>
            </SettingsModal.Tab>

            <SettingsModal.Tab
              id="public-link"
              title="Public link"
              icon="ti ti-link"
              description="Anyone with the UUID link can view this dashboard's included data."
            >
              <div class="flex flex-col gap-3">
                <div class={options.currentDashboard().publicEnabled ? "info-block-success" : "info-block-info"}>
                  {options.currentDashboard().publicEnabled
                    ? "Public display is enabled. Copy the link whenever you need it, or disable public access."
                    : "Public display is disabled. Create a link when you want to share this dashboard without auth."}
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    class="btn-input btn-input-sm"
                    disabled={options.loading()}
                    onClick={() => void options.enablePublicLink(options.currentDashboard(), { copy: true })}
                  >
                    <i class="ti ti-copy" />
                    {options.currentDashboard().publicEnabled ? "Copy public link" : "Create and copy link"}
                  </button>
                  <Show when={options.currentDashboard().publicEnabled}>
                    <button
                      type="button"
                      class="btn-input btn-input-sm"
                      disabled={options.loading()}
                      onClick={() => void options.disablePublicLink(options.currentDashboard())}
                    >
                      <i class="ti ti-link-off" />
                      Disable public link
                    </button>
                  </Show>
                </div>
              </div>
            </SettingsModal.Tab>

            <SettingsModal.Tab id="danger" title="Danger zone" icon="ti ti-alert-triangle" tone="danger" description="Delete this dashboard.">
              <button
                type="button"
                class="btn-danger btn-sm"
                disabled={options.loading()}
                onClick={() => void options.deleteDashboard(options.dashboard).then((deleted) => deleted && close())}
              >
                <i class="ti ti-trash text-sm" />
                Delete dashboard
              </button>
            </SettingsModal.Tab>
          </SettingsModal>
        </div>
      );
    },
    { surface: "bare", header: false, size: "large" },
  );
