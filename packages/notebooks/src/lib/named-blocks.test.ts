import { describe, expect, test } from "bun:test";
import { extractDataBlocks, extractNamedBlocks, renderNamedBlockHandlesMarkdown } from "./named-blocks";

describe("named blocks", () => {
  test("detects named block types in the current note", () => {
    const blocks = extractNamedBlocks(`@ideas
| Idea | Tags |
|---|---|
| Treehouse | #garden |

@shopping
- nails
- paint

@recipe
:::data
flour: 40
water: 20
:::

@materials
## Materials
Wood
`);

    expect(blocks.map((block) => [block.name, block.type])).toEqual([
      ["ideas", "table"],
      ["shopping", "list"],
      ["recipe", "data"],
      ["materials", "section"],
    ]);
  });

  test("does not treat handles inside fenced code as named blocks", () => {
    const blocks = extractNamedBlocks(`\`\`\`script
@insideCode
\`\`\`

@outside
- one
`);

    expect(blocks.map((block) => block.name)).toEqual(["outside"]);
  });

  test("detects nested handles inside named sections", () => {
    const blocks = extractNamedBlocks(`@review
# Review

- Use the weekly review button after a few daily notes.

@fooo
## Starter links

- [2026](note://abc123)
`);

    expect(blocks.map((block) => [block.name, block.type])).toEqual([
      ["review", "section"],
      ["fooo", "section"],
    ]);
  });

  test("renders only real handles for markdown output", () => {
    const rendered = renderNamedBlockHandlesMarkdown(`\`\`\`script
@insideCode
\`\`\`

@outside
- one
`);

    expect(rendered).toContain("@insideCode");
    expect(rendered).toContain('data-block-name="outside"');
    expect(rendered).not.toContain('data-block-name="insideCode"');
  });

  test("renders named data blocks as pretty html", () => {
    const rendered = renderNamedBlockHandlesMarkdown(`@recipe
:::data
flour: 40
tags:
  - bread
  - weekend
:::
`);

    expect(rendered).toContain('class="md-data-block"');
    expect(rendered).toContain('data-block-name="recipe"');
    expect(rendered).toContain("Flour");
    expect(rendered).toContain("bread");
    expect(rendered).not.toContain(":::data");
  });

  test("extracts and renders unnamed data blocks as pretty html", () => {
    const source = `Intro

:::data
flour: 40
water: 20
:::
`;
    const blocks = extractDataBlocks(source);
    const rendered = renderNamedBlockHandlesMarkdown(source);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.name).toBeNull();
    expect(rendered).toContain('class="md-data-block"');
    expect(rendered).toContain('class="md-data-handle-row"');
    expect(rendered).toContain("add @ref to use in scripts");
    expect(rendered).toContain("Flour");
    expect(rendered).toContain("Water");
    expect(rendered).not.toContain(":::data");
  });
});
