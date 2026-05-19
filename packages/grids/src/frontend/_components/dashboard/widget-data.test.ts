import { describe, expect, test } from "bun:test";
import { resolveWidgetData } from "../../../service/dashboard-widget-data";

describe("resolveWidgetData — markdown", () => {
  test("renders markdown through the shared renderer", async () => {
    const data = await resolveWidgetData(
      {
        id: "w_markdown",
        kind: "markdown",
        span: 6,
        title: "Help",
        markdown: "**Important**\n\n- Read this",
      },
      { userId: null, userGroups: [] },
    );

    expect(data.kind).toBe("markdown");
    if (data.kind !== "markdown") throw new Error("expected markdown data");
    expect(data.html).toContain("<strong>Important</strong>");
    expect(data.html).toContain("Read this");
  });
});
