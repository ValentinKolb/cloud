import { describe, expect, spyOn, test } from "bun:test";
import { resolveWidgetData } from "../../../service/dashboard-widget-data";
import * as fields from "../../../service/fields";
import type { Form } from "../../../service/forms";
import * as forms from "../../../service/forms";
import * as tables from "../../../service/tables";

const baseId = "11111111-1111-4111-8111-111111111111";
const tableId = "22222222-2222-4222-8222-222222222222";
const formId = "33333333-3333-4333-8333-333333333333";

const inactiveForm: Form = {
  id: formId,
  shortId: "F1234",
  tableId,
  name: "Inactive form",
  config: { fields: [] },
  publicToken: null,
  isActive: false,
  ownerUserId: null,
  position: 0,
  isDefault: false,
  deletedAt: null,
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
};

const inactiveFormSpies = () => [
  spyOn(forms, "get").mockResolvedValue(inactiveForm),
  spyOn(tables, "get").mockResolvedValue({ id: tableId, baseId, name: "Orders" } as never),
  spyOn(fields, "listByTable").mockResolvedValue([]),
];

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

describe("resolveWidgetData — inactive forms", () => {
  test("marks an inactive embedded form as not submittable", async () => {
    const spies = inactiveFormSpies();
    try {
      const data = await resolveWidgetData(
        { id: "w_form", kind: "form", span: 6, title: "Create order", formId },
        { userId: null, userGroups: [], isAdmin: true },
      );

      expect(data.kind).toBe("form");
      if (data.kind !== "form") throw new Error("expected form data");
      expect(data.canSubmit).toBe(false);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  test("blocks a dashboard link to an inactive form", async () => {
    const spies = inactiveFormSpies();
    try {
      const data = await resolveWidgetData(
        { id: "w_link", kind: "link", span: 6, title: "Create order", target: { kind: "form", formId } },
        { userId: null, userGroups: [], isAdmin: true },
      );

      expect(data.kind).toBe("link");
      if (data.kind !== "link") throw new Error("expected link data");
      expect(data.target).toEqual({ kind: "blocked", reason: "No submit access for this form" });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
