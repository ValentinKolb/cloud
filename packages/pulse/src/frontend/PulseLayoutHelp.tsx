import { Layout } from "@valentinkolb/cloud/ssr/islands";
import {
  PulseDashboardDslHelpPage,
  PulseInventoryHelpPage,
  PulseOperationsHelpPage,
  PulseQueryDslHelpPage,
  PulseStartHelpPage,
  PulseTroubleshootingHelpPage,
  PulseWorkflowHelpPage,
} from "./help/pulse-help-content";

export default function PulseLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="pulse-start"
        title="Start: Pulse"
        icon="ti ti-activity-heartbeat"
        description="Core concepts and the first path through a Pulse base."
        order={100}
      >
        <PulseStartHelpPage />
      </Layout.Help>
      <Layout.Help
        id="pulse-workflows"
        title="Workflows"
        icon="ti ti-route"
        description="Where to start when you know the resource, signal, query, or dashboard you need."
        order={105}
      >
        <PulseWorkflowHelpPage />
      </Layout.Help>
      <Layout.Help
        id="pulse-operations"
        title="Operations"
        icon="ti ti-database-share"
        description="Sources, ingest, retention, access, saved queries, and public displays."
        order={110}
      >
        <PulseOperationsHelpPage />
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
        id="pulse-inventory"
        title="Inventory"
        icon="ti ti-database-search"
        description="How to discover sources, resources, signals, variants, and dimensions."
        order={140}
      >
        <PulseInventoryHelpPage />
      </Layout.Help>
      <Layout.Help
        id="pulse-troubleshooting"
        title="Troubleshooting"
        icon="ti ti-lifebuoy"
        description="Common symptoms and the first place to check."
        order={150}
      >
        <PulseTroubleshootingHelpPage />
      </Layout.Help>
    </>
  );
}
