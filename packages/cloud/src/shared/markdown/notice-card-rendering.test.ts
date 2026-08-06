import { describe, expect, test } from "bun:test";
import { NOTICE_CARD_CLASSES, NOTICE_CARD_ICONS } from "@k2b/ui";
import { renderMarkdownSync } from ".";

describe("Markdown notice cards", () => {
  test("uses the shared NoticeCard contract for every callout tone", () => {
    const cases = [
      ["note", "neutral"],
      ["info", "info"],
      ["success", "success"],
      ["warning", "warning"],
      ["danger", "danger"],
    ] as const;

    for (const [directive, tone] of cases) {
      const html = renderMarkdownSync(`:::${directive}\nBody\n:::`);

      expect(html).toContain(`class="${NOTICE_CARD_CLASSES.root}"`);
      expect(html).toContain(`data-tone="${tone}"`);
      expect(html).toContain(`${NOTICE_CARD_ICONS[tone]} ${NOTICE_CARD_CLASSES.icon}`);
      expect(html).toContain(`class="${NOTICE_CARD_CLASSES.body}"`);
    }
  });
});
