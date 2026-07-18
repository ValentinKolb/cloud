---
id: grids-forms-dashboards
title: Forms & dashboards
icon: ti ti-layout-dashboard
description: Forms, widgets, embedded views, links, and dashboard permissions.
order: 130
---
Forms collect records. Dashboards combine records, summaries, charts, instructions, links, and actions into a working page.

### Dashboard widgets

- **Stats:** Show one value from a saved view or a GQL query stored directly in the widget.
- **Charts:** Read grouped GQL data from a saved view or a query stored directly in the widget. The source decides categories and values; the widget decides chart type and labels.
- **Embedded views:** Show row or summary results from a saved view or local GQL query inside a dashboard.
- **Markdown:** Add instructions, definitions, links, and ownership notes directly on the dashboard.
- **Links:** Open tables, views, forms, dashboards, or external URLs. Internal targets check their own permissions.
- **Workflow buttons:** Attach a saved dashboard launcher to let users run a workflow from a dashboard. Dashboard access and the workflow actions still enforce their applicable permissions.

:::note Permission rule
Data included directly on a dashboard follows dashboard access. Opening the original table or view, submitting a form, and writing a record check the original resource.
:::
