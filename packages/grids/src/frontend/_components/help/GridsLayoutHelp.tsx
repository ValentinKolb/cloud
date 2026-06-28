import { Layout } from "@valentinkolb/cloud/ssr/islands";
import {
  GridsBuildWorkflowsPage,
  GridsDashboardFormsPage,
  GridsInvoiceExamplePage,
  GridsOperationsPage,
  GridsPermissionsPage,
  GridsSearchPage,
  GridsStartPage,
  GridsTablesFieldsPage,
  GridsTroubleshootingPage,
  GridsViewsGqlPage,
} from "./grids-help-content";
import { GridsTemplatesPage } from "./grids-reference-pages";

export default function GridsLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="grids-start"
        title="Start: Grids"
        icon="ti ti-layout-grid"
        description="Core concepts and the first build path."
        order={100}
      >
        <GridsStartPage />
      </Layout.Help>
      <Layout.Help
        id="grids-build"
        title="Build workflows"
        icon="ti ti-route"
        description="Map common problems to the right Grids feature."
        order={105}
      >
        <GridsBuildWorkflowsPage />
      </Layout.Help>
      <Layout.Help
        id="grids-example"
        title="Example: invoices"
        icon="ti ti-receipt"
        description="A full base from tables to documents and automation."
        order={106}
      >
        <GridsInvoiceExamplePage />
      </Layout.Help>
      <Layout.Help
        id="grids-tables-fields"
        title="Tables & Fields"
        icon="ti ti-table"
        description="Records, field types, relations, selects, Markdown, and formulas."
        order={110}
      >
        <GridsTablesFieldsPage />
      </Layout.Help>
      <Layout.Help
        id="grids-views-query"
        title="Views & GQL"
        icon="ti ti-filter"
        description="Views, query building blocks, GQL, charts, and exports."
        order={120}
      >
        <GridsViewsGqlPage />
      </Layout.Help>
      <Layout.Help
        id="grids-templates"
        title="Templates & PDFs"
        icon="ti ti-file-type-pdf"
        description="GQL sources, Liquid HTML, snapshots, and generated documents."
        order={125}
      >
        <GridsTemplatesPage mode="guide" />
      </Layout.Help>
      <Layout.Help id="grids-search" title="Search" icon="ti ti-search" description="Search scope and exact filters." order={130}>
        <GridsSearchPage />
      </Layout.Help>
      <Layout.Help
        id="grids-dashboards-forms"
        title="Dashboards & Forms"
        icon="ti ti-layout-dashboard"
        description="Forms, widgets, embedded views, links, and dashboard permissions."
        order={140}
      >
        <GridsDashboardFormsPage />
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
        id="grids-operations"
        title="Operations"
        icon="ti ti-bolt"
        description="Automations, webhooks, files, documents, live refresh, and edit mode."
        order={150}
      >
        <GridsOperationsPage />
      </Layout.Help>
      <Layout.Help
        id="grids-troubleshooting"
        title="Troubleshooting"
        icon="ti ti-lifebuoy"
        description="Common symptoms and what to check first."
        order={160}
      >
        <GridsTroubleshootingPage />
      </Layout.Help>
    </>
  );
}
