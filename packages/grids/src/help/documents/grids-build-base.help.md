---
id: grids-build-base
title: Build a base
icon: ti ti-route
description: Map common work to the smallest useful Grids feature.
order: 106
---
Build the smallest base that makes the work clear. Add tables, views, forms, dashboards, documents, and workflows when each one removes a real manual step.

### Common choices

- **Collect data:** Create a table, then a form for guided entry. Use field descriptions for examples and validation intent.
- **Track work:** Use status, owner, due date, and saved views such as Open, Waiting, Done, or Overdue.
- **Report numbers:** Create a grouped view with aggregations, then use it in stats, charts, exports, or dashboard widgets.
- **Connect records:** Use relation fields. Mark one short field on the target table as the record label.
- **Generate documents:** Create a document template on the source table. Load data with GQL, lay it out with Liquid HTML, then generate PDFs from records.
- **Notify another system:** Create a record-triggered workflow with a filter and an httpRequest action.

### Boundaries

- **Make a table:** Use a table when records have their own lifecycle, permissions, forms, dashboards, documents, or relations.
- **Make a field:** Use a field when the value is one property of the same record.
- **Make a view:** Use a view when people need to revisit the same subset, display mode, or report.

### End-to-end example

1. **Create tables:** For invoices, create Customers and Invoices. Mark Customer name as the customer record label.
2. **Add invoice fields:** Add Invoice date, Due date, Status, Subtotal, Tax, Total, Paid, and Receipt.
3. **Create work views:** Create views such as Open invoices, Overdue invoices, Paid invoices, and Monthly income.
4. **Add output surfaces:** Use a dashboard for operational summaries and a document template when invoices need generated PDFs.
5. **Automate after the model is stable:** Use a workflow after the table, view, permission, and document rules are clear enough to trust.
