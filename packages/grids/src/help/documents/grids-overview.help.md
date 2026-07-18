---
id: grids-overview
title: Overview
icon: ti ti-layout-grid
description: What Grids is for and the first useful build path.
order: 100
---
Grids is a database app for structured office work. A base contains tables, tables contain records, and fields describe the facts each record stores. Views, forms, dashboards, exports, search, aggregations, document templates, and workflows all read from that saved table data.

### What Grids is for

- **Structured records:** Use tables when the data has fields, lifecycle, permissions, forms, views, dashboards, documents, or relations.
- **Operational views:** Use views when people revisit the same subset, order, grouping, aggregation, card board, or calendar.
- **Guided input:** Use forms when users should create records through a focused flow instead of opening the whole table.
- **Reports and dashboards:** Use dashboards for stats, charts, embedded views, Markdown, links, and workflow buttons.
- **Documents:** Use document templates to render PDFs from records with GQL data sources and Liquid HTML.
- **Workflows:** Use workflows for repeatable operations invoked directly, exposed through saved launchers, or started automatically by schedules and record events.

### First useful path

1. **Model the main table:** Add the smallest set of fields that users need today. Make the table useful before adding dashboards.
2. **Enter real sample records:** Real records reveal bad field names, missing required rules, and select options that are too vague.
3. **Add saved views:** Create views for repeated work: open work, recent records, grouped reports, cards, and calendars.
4. **Add forms and dashboards:** Use forms for data entry and dashboards for team-facing summaries or operating pages.
5. **Add documents and workflows last:** Create PDF templates and workflow actions once the table, view, and permission rules are clear enough to trust.

:::note Source of truth
Tables store data. Views shape queries. Forms create records. Dashboards present included data. Document templates generate PDFs from selected records. Workflows define inputs and steps; automatic triggers and saved launchers decide how runs start.
:::
