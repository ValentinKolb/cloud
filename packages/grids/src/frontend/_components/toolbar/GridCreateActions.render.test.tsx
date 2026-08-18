import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import "../ssr-test-plugin";

const { GridCreateActions } = await import("./GridCreateActions");

describe("GridCreateActions", () => {
  test("explains why records cannot be added when direct changes and forms are unavailable", () => {
    const html = renderToString(() =>
      createComponent(GridCreateActions, {
        baseId: "BASE01",
        tableId: "TABLE1",
        tableName: "Orders",
        disableDirectInsert: false,
        fields: [],
        forms: [],
        canWrite: true,
        canDirectWrite: false,
        canSubmitForms: false,
      }),
    );

    expect(html).toContain("Add record");
    expect(html).toContain("This table does not allow changes from direct editing or forms.");
    expect(html).toContain("Add record unavailable:");
    expect(html).toContain("disabled");
  });
});
