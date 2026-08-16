import { describe, expect, test } from "bun:test";
import { descriptionPreview } from "./description-preview";

describe("descriptionPreview", () => {
  test("keeps visible Markdown text without its presentation syntax", () => {
    expect(
      descriptionPreview(`
# Launch notes

- Confirm the **release owner**
- Invite the *support team*
- Share the [runbook](https://example.com/runbook)
- Check \`health/status\`

![Architecture](https://example.com/architecture.png)
      `),
    ).toBe("Launch notes Confirm the release owner Invite the support team Share the runbook Check health/status Architecture");
  });

  test("returns a bounded preview and handles empty descriptions", () => {
    expect(descriptionPreview("   ")).toBeNull();
    expect(descriptionPreview("A description that is too long", 16)).toBe("A description t…");
  });
});
