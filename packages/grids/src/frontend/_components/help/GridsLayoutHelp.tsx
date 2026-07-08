import { Layout } from "@valentinkolb/cloud/ssr/islands";
import {
  GridsBuildBasePage,
  GridsCoreModelPage,
  GridsDashboardFormsPage,
  GridsFormulaReferencePage,
  GridsOperationsTroubleshootingPage,
  GridsOverviewPage,
  GridsPermissionsPage,
  GridsTablesFieldsPage,
  GridsViewsReportsPage,
  GridsWorkflowsPage,
} from "./grids-help-content";
import { GridsGqlExamplesPage, GridsGqlHowItWorksPage, GridsGqlReferencePage, GridsTemplatesPage } from "./grids-reference-pages";

const GridsGqlHelpPage = () => (
  <div class="space-y-8">
    <GridsGqlReferencePage />
    <GridsGqlExamplesPage />
    <GridsGqlHowItWorksPage />
  </div>
);

export default function GridsLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="grids-overview"
        title="Overview"
        icon="ti ti-layout-grid"
        description="What Grids is for and the first useful build path."
        order={100}
      >
        <GridsOverviewPage />
      </Layout.Help>
      <Layout.Help
        id="grids-core-model"
        title="Core model"
        icon="ti ti-stack-2"
        description="Bases, tables, records, fields, relations, resources, and permission boundaries."
        order={105}
      >
        <GridsCoreModelPage />
      </Layout.Help>
      <Layout.Help
        id="grids-build-base"
        title="Build a base"
        icon="ti ti-route"
        description="Map common work to the smallest useful Grids feature."
        order={106}
      >
        <GridsBuildBasePage />
      </Layout.Help>
      <Layout.Help
        id="grids-tables-fields"
        title="Tables & fields"
        icon="ti ti-table"
        description="Records, field types, relations, selects, Markdown, and formulas."
        order={110}
      >
        <GridsTablesFieldsPage />
      </Layout.Help>
      <Layout.Help
        id="grids-views-reports"
        title="Views & reports"
        icon="ti ti-filter"
        description="Search, filters, sorting, grouping, aggregations, display modes, and reports."
        order={120}
      >
        <GridsViewsReportsPage />
      </Layout.Help>
      <Layout.Help
        id="grids-gql"
        title="GQL"
        icon="ti ti-code"
        description="Query syntax, examples, resolution, permissions, limits, and performance rules."
        order={125}
      >
        <GridsGqlHelpPage />
      </Layout.Help>
      <Layout.Help
        id="grids-formulas"
        title="Formulas"
        icon="ti ti-function"
        description="Formula syntax and the complete function catalog."
        order={126}
      >
        <GridsFormulaReferencePage />
      </Layout.Help>
      <Layout.Help
        id="grids-forms-dashboards"
        title="Forms & dashboards"
        icon="ti ti-layout-dashboard"
        description="Forms, widgets, embedded views, links, and dashboard permissions."
        order={130}
      >
        <GridsDashboardFormsPage />
      </Layout.Help>
      <Layout.Help
        id="grids-documents-pdfs"
        title="Documents & PDFs"
        icon="ti ti-file-type-pdf"
        description="GQL sources, Liquid HTML, snapshots, and generated documents."
        order={135}
      >
        <GridsTemplatesPage />
      </Layout.Help>
      <Layout.Help
        id="grids-automations"
        title="Automations"
        icon="ti ti-route"
        description="Workflow YAML inputs, triggers, steps, runs, permissions, and examples."
        order={140}
      >
        <GridsWorkflowsPage />
      </Layout.Help>
      <Layout.Help
        id="grids-permissions"
        title="Permissions"
        icon="ti ti-lock"
        description="Read, write, admin, included data, linked items, and documents."
        order={145}
      >
        <GridsPermissionsPage />
      </Layout.Help>
      <Layout.Help
        id="grids-operations-troubleshooting"
        title="Operations & troubleshooting"
        icon="ti ti-bolt"
        description="Operations, live refresh, common symptoms, and what to check first."
        order={150}
      >
        <GridsOperationsTroubleshootingPage />
      </Layout.Help>
    </>
  );
}
