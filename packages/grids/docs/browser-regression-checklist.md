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
- Build a dashboard with stat, chart, view, form, link, and markdown widgets.
- In dashboard edit mode, add rows, move widgets, resize widget spans, and save.
- Delete and restore a record, view, form, dashboard, table, and base.
- Check desktop, tablet, and mobile widths for table, detail panel, public form,
  and dashboard pages.
