# Grids Browser Regression Checklist

Use this for exploratory v1 checks that would be too brittle as automated
browser assertions.

- Create a base from `/app/grids`, then revisit `/app/grids` and confirm the
  last-opened redirect still lands on the recent page.
- Create/edit fields for: text, longtext markdown, number, date, select,
  relation, formula.
- Confirm table rows stay bounded with long markdown content.
- Open a record detail panel, edit the record, close with Escape, and verify the
  focus ring stays subtle.
- Create a view with filter, sort, group, aggregate, column formats, and footer
  aggregates.
- Export CSV and JSON from a filtered view.
- Create a form, submit it authenticated, enable public link, submit it
  anonymously.
- Publish a Custom App with Markdown, Records, Metric, Chart, Form, Record,
  Comments, and Actions blocks, then verify its declared page navigation.
- Delete and restore a record, view, form, table, and base.
- Check desktop, tablet, and mobile widths for table, detail panel, public form,
  and Custom App pages.
