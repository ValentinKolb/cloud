import { describe, expect, test } from "bun:test";
import { markdown } from "./index";

describe("markdown tables", () => {
  test("renders the shared table structure and column alignment", () => {
    const html = markdown.renderSync(`| Item | Amount |
|---|---:|
| Flour | 400 |`);

    expect(html).toContain('<div class="md-table-wrap">');
    expect(html).toContain('<table class="md-table">');
    expect(html).toContain('class="md-table-cell md-align-right"');
    expect(html).toContain("<span class=\"md-table-cell\">Flour</span>");
  });

  test("preserves formula and summary-row semantics", () => {
    const html = markdown.renderSync(`| Item | Amount |
|---|---:|
| Flour | 400 |
| Total | =SUM(Amount) |`);

    expect(html).toContain('class="md-table-total-row"');
    expect(html).toContain("md-formula-ok md-align-right");
    expect(html).toContain("ti-math-function");
    expect(html).toContain(">400</span>");
  });
});
