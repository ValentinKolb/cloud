import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { For, type JSX } from "solid-js";
import type { PulseDashboard } from "../../contracts";
import type { WorkspaceView } from "./types";

type Props = {
  title: string;
  subtitle: string;
  activeView: WorkspaceView;
  dashboards: PulseDashboard[];
  resourceCount: number;
  sourceCount: number;
  eventCount: number;
  stateCount: number;
  metricCount: number;
  retentionDays: number;
  timescaleEnabled: boolean;
  settingsDisabled: boolean;
  openSettings: () => void | Promise<void>;
  createDashboard: () => unknown;
  renderDashboardItem: (dashboard: PulseDashboard) => JSX.Element;
  openResources: () => void;
  openSources: () => void;
  openQueryExplorer: () => void;
  openActivityEvents: () => void;
  openActivityStates: () => void;
  openActivityMetrics: () => void;
};

const SidebarSections = (props: Props) => (
  <>
    <AppWorkspace.SidebarSection title="Dashboards">
      <AppWorkspace.SidebarItem icon="ti ti-plus" active={false} onClick={() => void props.createDashboard()}>
        New dashboard
      </AppWorkspace.SidebarItem>
      <For each={props.dashboards}>{(dashboard) => props.renderDashboardItem(dashboard)}</For>
    </AppWorkspace.SidebarSection>

    <AppWorkspace.SidebarSection title="Data">
      <AppWorkspace.SidebarItem
        icon="ti ti-cube"
        active={props.activeView === "resources" || props.activeView === "resource-detail"}
        onClick={props.openResources}
        meta={props.resourceCount}
      >
        Resources
      </AppWorkspace.SidebarItem>
      <AppWorkspace.SidebarItem icon="ti ti-database" active={props.activeView === "sources"} onClick={props.openSources} meta={props.sourceCount}>
        Sources
      </AppWorkspace.SidebarItem>
      <AppWorkspace.SidebarItem icon="ti ti-terminal-2" active={props.activeView === "explorer"} onClick={props.openQueryExplorer}>
        Query explorer
      </AppWorkspace.SidebarItem>
    </AppWorkspace.SidebarSection>

    <AppWorkspace.SidebarSection title="Signals">
      <AppWorkspace.SidebarItem
        icon="ti ti-bolt"
        active={props.activeView === "activity-events"}
        onClick={props.openActivityEvents}
        meta={props.eventCount}
      >
        Events
      </AppWorkspace.SidebarItem>
      <AppWorkspace.SidebarItem
        icon="ti ti-toggle-right"
        active={props.activeView === "activity-states"}
        onClick={props.openActivityStates}
        meta={props.stateCount}
      >
        States
      </AppWorkspace.SidebarItem>
      <AppWorkspace.SidebarItem
        icon="ti ti-chart-dots"
        active={props.activeView === "activity-metrics"}
        onClick={props.openActivityMetrics}
        meta={props.metricCount}
      >
        Metrics
      </AppWorkspace.SidebarItem>
    </AppWorkspace.SidebarSection>
  </>
);

export default function PulseSidebar(props: Props) {
  return (
    <AppWorkspace.Sidebar>
      <AppWorkspace.SidebarHeader
        title={props.title}
        subtitle={props.subtitle}
        icon="ti ti-activity-heartbeat"
        action={
          <button
            type="button"
            onClick={() => void props.openSettings()}
            class="absolute right-0 top-0 inline-flex h-6 w-6 items-center justify-center text-dimmed transition-colors hover:text-primary"
            title="Settings"
            aria-label={`Settings for ${props.title}`}
            disabled={props.settingsDisabled}
          >
            <i class="ti ti-settings text-xs" />
          </button>
        }
      />
      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey="pulse-sidebar-mobile">
          <div class="grid gap-3">
            <SidebarSections {...props} />
          </div>
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>
      <AppWorkspace.SidebarDesktop>
        <SidebarSections {...props} />

        <AppWorkspace.SidebarFooter>
          <div class="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-secondary dark:bg-zinc-900">
            <div class="flex items-center gap-2">
              <span class={`inline-flex h-2.5 w-2.5 rounded-full ${props.timescaleEnabled ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span>{props.timescaleEnabled ? "TimescaleDB enabled" : "Dev fallback"}</span>
            </div>
            <p class="mt-1">Retention: {props.retentionDays} days</p>
          </div>
        </AppWorkspace.SidebarFooter>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
