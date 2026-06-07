import { describe, expect, test } from "bun:test";
import { FormatSpecSchema, WidgetSchema } from "../../../contracts";

describe("dashboard widget contracts", () => {
  test("accepts an automation button widget", () => {
    const parsed = WidgetSchema.safeParse({
      id: "w_automation",
      kind: "automation-button",
      span: 4,
      automationId: "11111111-1111-4111-8111-111111111111",
      title: "Run invoice sync",
      description: "Sends open invoices to the accounting webhook.",
      buttonLabel: "Run sync",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(parsed.error.message);
    expect(parsed.data.kind).toBe("automation-button");
    if (parsed.data.kind !== "automation-button") throw new Error("expected automation button widget");
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
