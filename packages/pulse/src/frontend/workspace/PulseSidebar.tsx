import { AppWorkspace, Dropdown } from "@valentinkolb/cloud/ui";
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
  settingsDisabled: boolean;
  openSettings: () => void | Promise<void>;
  createDashboard: () => unknown;
  openDashboard: (dashboardId: string) => void;
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
      <AppWorkspace.SidebarItem
        icon="ti ti-database"
        active={props.activeView === "sources"}
        onClick={props.openSources}
        meta={props.sourceCount}
      >
        Sources
      </AppWorkspace.SidebarItem>
      <AppWorkspace.SidebarItem icon="ti ti-terminal-2" active={props.activeView === "explorer"} onClick={props.openQueryExplorer}>
        Query explorer
      </AppWorkspace.SidebarItem>
    </AppWorkspace.SidebarSection>

    <AppWorkspace.SidebarSection title="Signals">
      <AppWorkspace.SidebarItem
        icon="ti ti-bolt"
        active={props.activeView === "activity-events" || props.activeView === "event-detail"}
        onClick={props.openActivityEvents}
        meta={props.eventCount}
      >
        Events
      </AppWorkspace.SidebarItem>
      <AppWorkspace.SidebarItem
        icon="ti ti-toggle-right"
        active={props.activeView === "activity-states" || props.activeView === "state-detail"}
        onClick={props.openActivityStates}
        meta={props.stateCount}
      >
        States
      </AppWorkspace.SidebarItem>
      <AppWorkspace.SidebarItem
        icon="ti ti-chart-dots"
        active={props.activeView === "activity-metrics" || props.activeView === "metric-detail"}
        onClick={props.openActivityMetrics}
        meta={props.metricCount}
      >
        Metrics
      </AppWorkspace.SidebarItem>
    </AppWorkspace.SidebarSection>
  </>
);

export default function PulseSidebar(props: Props) {
  const collapsedDashboardMenu = () => [
    {
      sectionLabel: "Dashboards",
      items: [
        ...props.dashboards.map((dashboard) => ({
          icon: "ti ti-chart-area-line",
          label: dashboard.name,
          action: () => props.openDashboard(dashboard.id),
        })),
        { icon: "ti ti-plus", label: "New dashboard", action: () => void props.createDashboard() },
      ],
    },
  ];

  return (
    <AppWorkspace.Sidebar collapsible>
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
        <AppWorkspace.SidebarBody scrollPreserveKey="pulse-sidebar" sidebarMode="expanded">
          <SidebarSections {...props} />
        </AppWorkspace.SidebarBody>
        <AppWorkspace.SidebarSection sidebarMode="collapsed">
          <Dropdown
            trigger={
              <AppWorkspace.SidebarIconAction
                icon="ti ti-chart-area-line"
                label="Dashboards"
                active={props.activeView === "dashboard" || props.activeView === "dashboard-edit"}
              />
            }
            elements={collapsedDashboardMenu()}
            position="right-start"
            width="w-64"
            triggerClass="flex w-full"
            openOnHover
          />
        </AppWorkspace.SidebarSection>
        <AppWorkspace.SidebarIconGrid sidebarMode="collapsed">
          <AppWorkspace.SidebarIconAction
            icon="ti ti-cube"
            label="Resources"
            active={props.activeView === "resources" || props.activeView === "resource-detail"}
            onClick={props.openResources}
          />
          <AppWorkspace.SidebarIconAction
            icon="ti ti-database"
            label="Sources"
            active={props.activeView === "sources"}
            onClick={props.openSources}
          />
          <AppWorkspace.SidebarIconAction
            icon="ti ti-terminal-2"
            label="Query explorer"
            active={props.activeView === "explorer"}
            onClick={props.openQueryExplorer}
          />
          <AppWorkspace.SidebarIconAction
            icon="ti ti-bolt"
            label="Events"
            active={props.activeView === "activity-events" || props.activeView === "event-detail"}
            onClick={props.openActivityEvents}
          />
          <AppWorkspace.SidebarIconAction
            icon="ti ti-toggle-right"
            label="States"
            active={props.activeView === "activity-states" || props.activeView === "state-detail"}
            onClick={props.openActivityStates}
          />
          <AppWorkspace.SidebarIconAction
            icon="ti ti-chart-dots"
            label="Metrics"
            active={props.activeView === "activity-metrics" || props.activeView === "metric-detail"}
            onClick={props.openActivityMetrics}
          />
        </AppWorkspace.SidebarIconGrid>
        <div class="min-h-0 flex-1" />
        <AppWorkspace.SidebarFooter sidebarMode="collapsed">
          <AppWorkspace.SidebarIconGrid>
            <AppWorkspace.SidebarIconAction
              icon="ti ti-settings"
              label={`Settings for ${props.title}`}
              disabled={props.settingsDisabled}
              onClick={() => void props.openSettings()}
            />
          </AppWorkspace.SidebarIconGrid>
        </AppWorkspace.SidebarFooter>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
