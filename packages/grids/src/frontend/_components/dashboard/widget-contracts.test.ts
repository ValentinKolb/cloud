import { describe, expect, test } from "bun:test";
import { FormatSpecSchema, WidgetSchema } from "../../../contracts";

describe("dashboard widget contracts", () => {
  test("accepts a workflow button widget", () => {
    const parsed = WidgetSchema.safeParse({
      id: "w_workflow",
      kind: "workflow-button",
      span: 4,
      launcherId: "11111111-1111-4111-8111-111111111111",
      title: "Run invoice sync",
      description: "Runs the configured invoice workflow.",
      buttonLabel: "Run sync",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(parsed.error.message);
    expect(parsed.data.kind).toBe("workflow-button");
    if (parsed.data.kind !== "workflow-button") throw new Error("expected workflow button widget");
    expect(parsed.data.launcherId).toBe("11111111-1111-4111-8111-111111111111");
    expect(parsed.data.buttonLabel).toBe("Run sync");
  });

  test("accepts sparkline chart widgets", () => {
    const parsed = WidgetSchema.safeParse({
      id: "w_spark",
      kind: "chart",
      chartType: "sparkline",
      viewId: "11111111-1111-4111-8111-111111111111",
    });

    expect(parsed.success).toBe(true);
  });

  test("accepts barcode display formats", () => {
    expect(FormatSpecSchema.safeParse({ kind: "barcode", bcid: "qrcode", showText: true }).success).toBe(true);
    expect(FormatSpecSchema.safeParse({ kind: "barcode", bcid: "../qrcode" }).success).toBe(false);
  });
});
