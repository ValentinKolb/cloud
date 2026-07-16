import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { navigate } from "@valentinkolb/ssr/nav";
import { createSignal, For } from "solid-js";
import type {
  PulseCurrentState,
  PulseMetricSeries,
  PulseMetricSummary,
  PulseRecordedEvent,
  PulseSignalField,
  PulseSource,
} from "../contracts";
import { PulseDashboardDslHelpPage, PulseQueryDslHelpPage, PulseReferenceOverviewPage } from "./help/pulse-help-content";
import { PulseQueryReferenceInventory } from "./PulseQueryReferenceInventory";
import { defaultReferenceTab, isAvailableReferenceTab, type ReferenceTab, referenceTabs } from "./query-reference-tabs";

type Props = {
  baseName: string;
  includeDashboardDsl: boolean;
  initialTab?: ReferenceTab;
  metrics: PulseMetricSummary[];
  events: PulseRecordedEvent[];
  states: PulseCurrentState[];
  sources: PulseSource[];
  series: PulseMetricSeries[];
  fields: PulseSignalField[];
};

const readInitialTab = (includeDashboardDsl: boolean, initialTab?: ReferenceTab): ReferenceTab => {
  if (isAvailableReferenceTab(initialTab, includeDashboardDsl)) return initialTab;
  if (typeof window === "undefined") return defaultReferenceTab(includeDashboardDsl);
  const value = new URL(window.location.href).searchParams.get("tab");
  return isAvailableReferenceTab(value, includeDashboardDsl) ? value : defaultReferenceTab(includeDashboardDsl);
};

const writeTabParam = (tab: ReferenceTab) => {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  navigate(`${url.pathname}${url.search}`, { replace: true, scroll: "preserve", viewTransition: false });
};

export default function PulseQueryReferenceWindow(props: Props) {
  const [activeTab, setActiveTab] = createSignal<ReferenceTab>(readInitialTab(props.includeDashboardDsl, props.initialTab));

  const switchTab = (tab: ReferenceTab) => {
    setActiveTab(tab);
    writeTabParam(tab);
  };

  const renderReferenceNav = () => (
    <AppWorkspace.SidebarSection title="Reference">
      <For each={referenceTabs(props.includeDashboardDsl)}>
        {(tab) => (
          <AppWorkspace.SidebarItem icon={tab.icon} active={activeTab() === tab.value} onClick={() => switchTab(tab.value)}>
            {tab.label}
          </AppWorkspace.SidebarItem>
        )}
      </For>
    </AppWorkspace.SidebarSection>
  );

  const renderOverview = () => <PulseReferenceOverviewPage includeDashboardDsl={props.includeDashboardDsl} />;
  const renderQueryDsl = () => <PulseQueryDslHelpPage />;
  const renderDashboardDsl = () => <PulseDashboardDslHelpPage />;

  const renderInventory = () => (
    <PulseQueryReferenceInventory
      metrics={props.metrics}
      events={props.events}
      states={props.states}
      sources={props.sources}
      series={props.series}
      fields={props.fields}
    />
  );

  return (
    <AppWorkspace class="h-screen">
      <AppWorkspace.Sidebar>
        <AppWorkspace.SidebarHeader title="Pulse reference" subtitle={props.baseName} icon="ti ti-book" />
        <AppWorkspace.SidebarMobile>
          <AppWorkspace.SidebarMobileBody scrollPreserveKey="pulse-reference-mobile">{renderReferenceNav()}</AppWorkspace.SidebarMobileBody>
        </AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarDesktop>
          <AppWorkspace.SidebarBody scrollPreserveKey="pulse-reference-sidebar">{renderReferenceNav()}</AppWorkspace.SidebarBody>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>

      <AppWorkspace.Content>
        <AppWorkspace.Main class="overflow-y-auto p-[var(--ui-space-shell)]">
          <div class="mx-auto flex w-full max-w-7xl flex-col gap-5">
            {activeTab() === "overview"
              ? renderOverview()
              : activeTab() === "query"
                ? renderQueryDsl()
                : activeTab() === "dashboard"
                  ? renderDashboardDsl()
                  : renderInventory()}
          </div>
        </AppWorkspace.Main>
      </AppWorkspace.Content>
    </AppWorkspace>
  );
}
