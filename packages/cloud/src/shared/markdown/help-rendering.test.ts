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
});
