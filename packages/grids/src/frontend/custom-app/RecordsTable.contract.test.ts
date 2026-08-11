import { describe, expect, test } from "bun:test";

describe("App Records table actions", () => {
  test("renders plural accessible row actions and sends the selected row id", async () => {
    const source = await Bun.file(new URL("./RecordsTable.island.tsx", import.meta.url)).text();

    expect(source).toContain("<For each={props.rowActions ?? []}>");
    expect(source).toContain("<IconButton");
    expect(source).toContain("label={action.label}");
    expect(source).toContain("body: { rowId }");
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain("window.setTimeout(() => window.location.reload()");
    expect(source).toContain("props.preview || Boolean(pendingKey())");
    expect(source).toContain("if (props.preview) return");
  });
});
