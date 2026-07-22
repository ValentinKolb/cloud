---
id: grids-forms-dashboards
title: Forms & dashboards
icon: ti ti-layout-dashboard
description: Build focused entry flows and role-specific working pages.
order: 130
---
Forms and dashboards simplify how people use a base. A form collects one record through a guided flow. A dashboard brings the information and actions for a role or process onto one page.

They do not replace tables. Forms write table records, and dashboard data comes from saved views or GQL queries.

## Create a focused form {icon="forms"}

Every table has a virtual default form based on its fields. Create a custom form when users need different labels, help text, required inputs, defaults, a smaller field set, or a controlled public link.

In a custom form you can:

- choose the title, description, title image, submit label, and success message;
- arrange user inputs and explain what each answer means;
- apply hidden values on the server, such as a fixed request status;
- allow configured relation fields to create related records inline;
- redirect after a successful submission;
- pause submissions without deleting the form.

An internal user can submit with **Write/Use** access to the form or inherited table write access. They do not need permission to browse the table when the form itself grants use.

Turn on **Public form** only when anonymous submissions are intended. The public URL contains a random share token and writes through the form's configured fields and server-managed values. Turning public access off invalidates the existing link; enabling it again creates a new one.

Test a form with incomplete and invalid input before sharing it. Confirm that required fields, relation creation, success text, and redirect behavior are understandable without knowledge of the table.

## Build a dashboard around a job {icon="layout-dashboard"}

A dashboard should answer “What does this person need to see or do here?” Start with one audience, such as an inventory desk or finance reviewer, and add only widgets that support that job.

Available widgets are:

| Widget | Use |
| --- | --- |
| Number | Highlight one value |
| Records | Show row or summary results |
| Chart | Show a donut, bar, line, sparkline, or scatter chart |
| Summary | Show several values together |
| Form | Let people add a record |
| Text | Add Markdown instructions or context |
| Link | Open a dashboard, table, view, form, or URL |
| Workflow | Run a saved dashboard action or open a scanner |

Number, Records, Chart, and Summary widgets can read either a **Saved view** or a **Query** stored directly in the widget. Choose a saved view when the same result belongs in navigation or several places. Choose a local query when it exists only for that widget.

The data source defines records, groups, and aggregate values. The widget defines presentation such as chart type, labels, number format, size, and height. If a chart is empty, inspect the grouped source before changing chart settings.

Number widgets and chart axes use the same value settings. Choose **Number** for decimal values, **Integer** for counts, or **Percent** when the query returns a fraction such as `0.19` for 19%. Number values may show an explicit unit such as `EUR`, `kg`, or `hours` before or after the value. Decimal places and units change only the display; the query result and exported data stay unchanged. Grids does not infer a currency from a field or query.

## Match the source to the widget {icon="layout-dashboard"}

Start with the question the widget should answer, then shape its source. The editor validates the source before saving.

| Widget | Expected source |
| --- | --- |
| Number | One value. The first aggregate column is preferred; otherwise the first output column is used. |
| Records | Row or summary results. The dashboard shows the first page; a saved view can also link to its full page when the reader may open it. |
| Summary | One row or grouped bucket. Every output column in that first result becomes a compact labeled value. |
| Donut or bar chart | One grouped column and at least one aggregate. The first aggregate supplies the values. |
| Line chart | One grouped column and one or more aggregates. Each aggregate becomes a series. |
| Sparkline | One grouped column and at least one aggregate. The first aggregate supplies the trend. |
| Scatter chart | One grouped column and at least two aggregates. The first two aggregates become the x and y values. |

For a time series, group a date field by `day`, `week`, `month`, `quarter`, or `year`, aggregate the measure, and sort the date ascending. A chart's optional bucket limit keeps the most recent 1–1,000 source buckets after the query has filtered and sorted them.

A Number widget may add a separate grouped trend source with a 2–60 bucket window. This changes only the small trend line; it does not change the main value.

## Arrange the working page {icon="route"}

Edit mode lets you add rows, move rows and widgets, choose a widget width, and set each row to **Compact**, **Standard**, or **Tall**. Widths use a 12-column row: quarter, third, half, two-thirds, three-quarters, or full width. Prefer Compact for numbers and actions, Standard for mixed content, and Tall for charts, record results, and forms.

Use Text widgets for instructions close to the action they explain. Use Link widgets for deliberate navigation to another dashboard, table, view, form, or external URL. A Workflow widget uses a saved dashboard or scanner launcher; it does not embed workflow YAML in the dashboard.

When a widget reports an error or no data, open its settings and check the source first:

:::steps
1. Run the saved view or local GQL query and confirm that it returns rows.
2. For charts, confirm that the result contains the required group and aggregate columns.
3. Confirm that the reader has dashboard access and that embedded forms or workflows are still enabled.
:::

## Share dashboards deliberately {icon="shield-lock"}

A personal dashboard belongs to its owner. A shared dashboard is visible by default to base readers, and explicit dashboard access can narrow or grant access.

Data rendered directly inside a readable dashboard follows dashboard access. This lets a dashboard act as a controlled operating surface without exposing every source table. Opening a linked table or view checks that target's access separately.

Embedded forms and workflow actions still authorize the operation they perform. Dashboard read access alone does not grant record writes or arbitrary workflow execution.

Duplicating a dashboard copies its layout and widget configuration, not its access entries. Review sharing before publishing the copy.

:::note Less, but useful
A dashboard is not a second navigation system. Prefer a few clear numbers, lists, instructions, and actions over a wall of widgets that repeats the entire base.
:::
