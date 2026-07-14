import { DataTable, type DataTableColumn, DocCode, DocInlineCode, DocLead, DocNote, DocSection } from "@valentinkolb/cloud/ui";
import { pulseDashboardDslHighlight } from "../query-authoring";
import { PulseCopyCell, PulseDocPage, PulseStepList } from "./pulse-help-primitives";

type DashboardStatementRow = {
  statement: string;
  scope: string;
  meaning: string;
  example: string;
};

const dashboardSyntax = `dashboard "Name" {
  description "Optional context."

  controls {
    range "Range" variable range default 24h options 1h, 6h, 24h, 7d
    source "Source" variable source_id default 00000000-0000-4000-8000-000000000000
    entity "Entity" variable entity_id type container default container:app-core
    label "Region" variable region default eu options eu, us
    text "Search" variable search default ""
  }

  section "Section" {
    row height md {
      line "Chart title" {
        query metric orders.created increase every 1h since $range source $source_id where region=$region
        warn when value > 100
      }
    }

    table "Recent events" {
      query events deploy.finished since $range entity $entity_id limit 50
    }

    table "Current states" {
      query states service.online entity $entity_id limit 50
    }

    markdown "Notes" {
      """
      ## Markdown content
      Add context, links, and operating notes.
      """
    }
  }
}`;

const dashboardExample = `dashboard "Solar overview" {
  description "Live power, battery state, and grid interaction."

  section "Today" {
    description "Operational view for the current day."

    card "Battery" {
      description "Shows current charge and recent charge/discharge trend."

      gauge "Charge" {
        description "Latest state of charge reported by the inverter."
        query metric solar.battery.charge_percent latest since 10m
        warn when value < 20 message "Battery is low"
        critical when value < 10 message "Battery is critical"
      }
    }

    markdown "Notes" {
      """
      ## Operating notes

      - Values update every minute.
      - Grid import above 2 kW usually means the battery is empty.
      - Check inverter status if output drops while irradiance is high.
      """
    }
  }
}`;

const minimalDashboardExample = `dashboard "Ops" {
  section "Overview" {
    stat "Requests" {
      query metric http_requests_total rate every 1m since 1h
    }
  }
}`;

const dashboardControlExample = `dashboard "Ops" {
  controls {
    range "Range" variable range default 24h options 1h, 6h, 24h, 7d
    entity "Container" variable entity_id type container default container:app-core
  }

  section "Container" {
    line "Memory" {
      query metric docker.container.memory.usage avg every 5m since $range entity $entity_id
    }
  }
}`;

const dashboardStatementRows: DashboardStatementRow[] = [
  {
    statement: 'dashboard "Name" { ... }',
    scope: "root",
    meaning: "Defines one dashboard document. This is the canonical editable source.",
    example: 'dashboard "Ops" { section "Main" {} }',
  },
  {
    statement: 'description "Text"',
    scope: "dashboard, section, card, widget, markdown",
    meaning: "Adds reader-facing context without changing data queries.",
    example: 'description "Live operational view."',
  },
  {
    statement: "controls { ... }",
    scope: "dashboard",
    meaning: "Declares reusable variables rendered above the dashboard.",
    example: 'controls { range "Range" variable range default 24h options 1h, 24h }',
  },
  {
    statement: 'range/source/entity/entity_type/label/text "Label"',
    scope: "controls",
    meaning: "Creates a control. Use variable, default, options, and type where useful. If default is omitted, the first option is used.",
    example: 'entity "Container" variable entity_id type container default container:app-core',
  },
  {
    statement: 'section "Name" { ... }',
    scope: "dashboard, section",
    meaning: "Groups related rows and nested sections.",
    example: 'section "Today" { line "Orders" { query metric orders.created increase since 24h } }',
  },
  {
    statement: "row height sm|md|lg { ... }",
    scope: "section, card",
    meaning: "Places multiple widgets in one row. If height is omitted, md is used.",
    example: 'row height lg { line "CPU" { query metric system.cpu.usage avg since 6h } }',
  },
  {
    statement: 'card "Name" [span n] { ... }',
    scope: "section, row, card",
    meaning: "Frames related child widgets and optional markdown. Span is an optional integer from 1 to 12.",
    example: 'card "Battery" span 6 { gauge "Charge" { query metric battery.charge latest since 10m } }',
  },
  {
    statement: 'markdown ["Name"] [span n] { """ ... """ }',
    scope: "section, row, card",
    meaning: "Adds Markdown notes, explanations, runbooks, or links. Markdown content must be triple-quoted.",
    example: 'markdown "Notes" { """## Notes\\n- Check importer health.""" }',
  },
  {
    statement: 'line/bar/stat/gauge/barGauge/histogram/heatmap/table "Name"',
    scope: "section, row, card",
    meaning:
      "Adds a query-backed widget. barGauge is case-sensitive. Events render only as table widgets; states render as table or stat widgets.",
    example: 'gauge "Charge" { query metric battery.charge latest since 10m }',
  },
  {
    statement: "query <Query DSL>",
    scope: "widget",
    meaning:
      "Embeds metric, events, or states Query DSL. Dashboard controls may be referenced as $variables. Event widgets render raw rows; event aggregation points are Query Explorer and CLI results.",
    example: "query metric orders.created increase every 1h since $range where region=$region",
  },
  {
    statement: "warn|critical when value <op> <value>",
    scope: "metric widget",
    meaning:
      "Applies visual state to metric values only. Operators are >, >=, <, <=, =, and !=. Optional message text can explain the condition.",
    example: 'critical when value > 95 message "Capacity almost full"',
  },
  {
    statement: "# comment or // comment",
    scope: "anywhere whitespace is allowed",
    meaning: "Adds a line comment in the dashboard DSL source. Comments are ignored by the parser.",
    example: "# explain why this section exists",
  },
];

const dashboardStatementColumns: DataTableColumn<DashboardStatementRow>[] = [
  { id: "statement", header: "Statement", value: "statement", cellClass: "min-w-72" },
  { id: "scope", header: "Scope", value: "scope", cellClass: "w-40 whitespace-nowrap" },
  { id: "meaning", header: "Meaning", value: "meaning" },
  { id: "copy", header: "", value: (row) => row.example, headerClass: "w-12", cellClass: "w-12" },
];

export const PulseDashboardDslHelpPage = () => (
  <PulseDocPage>
    <DocLead>
      Dashboard DSL is the dashboard source of truth. Write the operating view as text, preview it, and keep layout, queries, notes, and
      visual warning states reviewable in one place.
    </DocLead>

    <DocSection title="Build in layers" eyebrow="Dashboard DSL">
      <PulseStepList
        items={[
          {
            title: "Start with one section",
            text: "Give the dashboard a name and add the smallest section that answers one real question.",
          },
          { title: "Add one widget", text: "Use stat, gauge, line, bar, histogram, heatmap, or table depending on the query output." },
          {
            title: "Add controls when repetition appears",
            text: "Use controls for range, source, entity, entity_type, label, or text values that multiple widgets share.",
          },
          {
            title: "Group related widgets",
            text: "Use rows for side-by-side charts, cards for a related cluster, and sections for larger topics.",
          },
          { title: "Explain decisions in place", text: "Use descriptions and markdown for operating notes, assumptions, and links." },
        ]}
      />
    </DocSection>

    <DocSection title="Smallest useful dashboard">
      <DocCode title="Minimal dashboard" code={minimalDashboardExample} highlight={pulseDashboardDslHighlight} copy />
      <p class="text-dimmed">
        This is enough to render a dashboard: a root document, one section, one widget, and one query. Add structure when the dashboard
        starts repeating itself.
      </p>
    </DocSection>

    <DocSection title="Add controls when values repeat">
      <DocCode title="Controls and variables" code={dashboardControlExample} highlight={pulseDashboardDslHighlight} copy />
      <p class="text-dimmed">
        Controls create variables such as <DocInlineCode>$range</DocInlineCode> or <DocInlineCode>$entity_id</DocInlineCode>. Public
        displays use the default values, so choose defaults that make sense without interaction.
      </p>
    </DocSection>

    <DocSection title="Full shape">
      <div class="space-y-3">
        <DocCode title="Shape" code={dashboardSyntax} highlight={pulseDashboardDslHighlight} copy />
        <DocCode title="Example" code={dashboardExample} highlight={pulseDashboardDslHighlight} copy />
      </div>
    </DocSection>

    <DocSection title="Statement reference">
      <DataTable
        rows={dashboardStatementRows}
        columns={dashboardStatementColumns}
        getRowId={(row) => row.statement}
        class="paper max-h-[520px] overflow-auto"
        density="compact"
        renderCell={({ row, col, value }) => {
          if (col.id === "statement") return <code class="font-mono text-secondary">{row.statement}</code>;
          if (col.id === "copy") return PulseCopyCell(String(value));
          return <span class="text-dimmed">{String(value ?? "-")}</span>;
        }}
      />
    </DocSection>

    <DocSection title="Design rules">
      <div class="grid gap-3 text-sm lg:grid-cols-2">
        <DocNote title="Dashboards compose query output" variant="info">
          Widget <DocInlineCode>query</DocInlineCode> lines use the same Query DSL. Metric widgets render values and charts; table widgets
          render raw event rows and current states. Event aggregation points are available in the Query Explorer and CLI, not dashboard
          widgets.
        </DocNote>
        <DocNote title="Controls define variables" variant="info">
          Declare controls once, then use variables inside widget queries. This keeps dashboards editable without duplicating filters.
        </DocNote>
        <DocNote title="Public displays use defaults" variant="info">
          Public links render with each control's default value. Keep public dashboards deterministic by choosing useful defaults.
        </DocNote>
        <DocNote title="Conditions are visual" variant="warning">
          Use <DocInlineCode>warn when value &gt; 80</DocInlineCode> or <DocInlineCode>critical when value = false</DocInlineCode> to mark
          metric widgets visually. Alert delivery and webhooks are a separate future layer.
        </DocNote>
      </div>
    </DocSection>
  </PulseDocPage>
);
