import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import "../ssr-test-plugin";

const { CardSizeDropdown } = await import("./CardSizeDropdown");

describe("CardSizeDropdown", () => {
  test("renders card sizes through the accessible selection contract", () => {
    const html = renderToString(() =>
      createComponent(CardSizeDropdown, {
        value: "medium",
        onChange: () => undefined,
      }),
    );

    expect(html).toContain('aria-label="Card size"');
    expect(html).toContain('role="menuitemradio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Small cards");
    expect(html).toContain("Medium cards");
    expect(html).toContain("Large cards");
    expect(html.match(/ti-check/g)).toHaveLength(1);
  });
});
