import { describe, expect, test } from "bun:test";
import { renderHelpMarkdown } from ".";

describe("renderHelpMarkdown", () => {
  test("highlights JavaScript while keeping help examples inert", () => {
    const html = renderHelpMarkdown('```script\nconst message = "hello";\n```');

    expect(html).toContain('<span class="hl-keyword">const</span>');
    expect(html).toContain('<span class="hl-string">"hello"</span>');
    expect(html).not.toContain("data-script-source");
  });

  test("supports documentation languages through the shared highlighter", () => {
    const html = renderHelpMarkdown("```gql\nquery Item($id: ID!) { item(id: $id) { id } }\n```\n\n```yaml\nenabled: true\n```");

    expect(html).toContain('<span class="hl-keyword">query</span>');
    expect(html).toContain('<span class="hl-variable">$id</span>');
    expect(html).toContain('<span class="hl-keyword">true</span>');
  });

  test("renders guided sections with stable ids and icons", () => {
    const html = renderHelpMarkdown('## Start here {icon="route"}\n\nText\n\n## Start here {icon="route"}');

    expect(html).toContain('id="start-here"');
    expect(html).toContain('id="start-here-2"');
    expect(html).toContain('data-help-icon="ti ti-route"');
    expect(html).not.toContain("{icon=");
  });

  test("preserves inline Markdown in guided section titles", () => {
    const html = renderHelpMarkdown('## Branch with `switch` {icon="point"}');

    expect(html).toContain("<span>Branch with <code");
    expect(html).toContain(">switch</code></span>");
    expect(html).not.toContain("{icon=");
  });

  test("renders explicit guided blocks without changing ordinary lists", () => {
    const html = renderHelpMarkdown(
      [
        ":::steps",
        "1. **Choose:** Pick one.",
        "2. **Finish:** Save it.",
        ":::",
        "",
        ":::reference",
        "- **Name:** Human-readable label.",
        "- **ID:** Stable identifier.",
        ":::",
        "",
        ":::compare",
        "- **Markdown:** Rich output.",
        "- **Plain text:** Simple output.",
        ":::",
        "",
        "1. An ordinary ordered list.",
      ].join("\n"),
    );

    expect(html).toContain('class="help-steps"');
    expect(html).toContain('class="help-reference"');
    expect(html).toContain('class="help-compare"');
    expect(html.match(/class="help-steps"/g)).toHaveLength(1);
    expect(html).toContain("An ordinary ordered list.");
  });

  test("does not interpret guided syntax inside fenced examples", () => {
    const html = renderHelpMarkdown(
      ["```md", '## Example {icon="route"}', "", ":::steps", "1. A documented step.", ":::", "```"].join("\n"),
    );

    expect(html).toContain("## Example");
    expect(html).toContain('{icon="route"}');
    expect(html).toContain(":::steps");
    expect(html).not.toContain('class="help-steps"');
    expect(html).not.toContain('class="help-section-title"');
  });

  test("keeps unsupported directives as ordinary help content", () => {
    const html = renderHelpMarkdown([":::timeline", "- A dated event", ":::"].join("\n"));

    expect(html).not.toContain('class="help-timeline"');
    expect(html).toContain("timeline");
    expect(html).toContain("A dated event");
  });
});
