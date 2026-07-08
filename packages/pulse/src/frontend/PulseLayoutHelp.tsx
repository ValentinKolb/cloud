import { Layout } from "@valentinkolb/cloud/ssr/islands";
import {
  PulseDashboardDslHelpPage,
  PulseDataModelHelpPage,
  PulseFindDataHelpPage,
  PulseOperateHelpPage,
  PulseQueryDslHelpPage,
  PulseReferenceOverviewPage,
  PulseStartHelpPage,
} from "./help/pulse-help-content";

export default function PulseLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="pulse-start"
        title="Overview"
        icon="ti ti-activity-heartbeat"
        description="Core concepts and the first path through a Pulse base."
        order={100}
      >
        <PulseStartHelpPage />
      </Layout.Help>
      <Layout.Help
        id="pulse-data-model"
        title="Data model"
        icon="ti ti-stack-2"
        description="How sources, resources, signals, variants, and dimensions fit together."
        order={105}
      >
        <PulseDataModelHelpPage />
      </Layout.Help>
      <Layout.Help
        id="pulse-find-data"
        title="Find data"
        icon="ti ti-database-search"
        description="Where to start when you know the source, resource, signal, or dashboard you need."
        order={110}
      >
        <PulseFindDataHelpPage />
      </Layout.Help>
      <Layout.Help
        id="pulse-query-language"
        title="Query DSL"
        icon="ti ti-terminal-2"
        description="Metric, event, and state query syntax with aggregations and examples."
        order={120}
      >
        <PulseQueryDslHelpPage />
      </Layout.Help>
      <Layout.Help
        id="pulse-dashboard-dsl"
        title="Dashboard DSL"
        icon="ti ti-layout-dashboard"
        description="Controls, sections, rows, cards, widgets, markdown, and conditions."
        order={130}
      >
        <PulseDashboardDslHelpPage />
      </Layout.Help>
      <Layout.Help
        id="pulse-reference"
        title="Reference"
        icon="ti ti-book"
        description="Canonical query, dashboard, and inventory lookup path."
        order={135}
      >
        <PulseReferenceOverviewPage includeDashboardDsl />
      </Layout.Help>
      <Layout.Help
        id="pulse-operate"
        title="Operate"
        icon="ti ti-lifebuoy"
        description="Source health, retention, access, public displays, and common symptoms."
        order={140}
      >
        <PulseOperateHelpPage />
      </Layout.Help>
    </>
  );
}
