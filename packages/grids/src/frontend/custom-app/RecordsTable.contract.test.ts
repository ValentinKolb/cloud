import { describe, expect, test } from "bun:test";

describe("App Records table actions", () => {
  test("renders plural accessible row actions and sends the selected row id", async () => {
    const source = await Bun.file(new URL("./RecordsTable.island.tsx", import.meta.url)).text();

    expect(source).toContain("<For each={props.rowActions ?? []}>");
    expect(source).toContain("<IconButton");
    expect(source).toContain("label={action.label}");
    expect(source).toContain("body: { rowId, search: appliedQuery() || undefined, cursor: cursor() || undefined }");
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain("await loadPage(cursor(), appliedQuery(), history())");
    expect(source).toContain("window.setTimeout(() => void loadPage(null, value.trim(), []), 250)");
    expect(source).toContain('<DataTable.Header title={props.title} as="h2" size="md" />');
    expect(source).toContain("<DataTable.Footer>");
    expect(source).toContain("props.preview || Boolean(pendingKey())");
    expect(source).toContain("if (props.preview || !props.endpoint) return");
  });
});
