import { describe, expect, test } from "bun:test";
import { normalizeFormConfig, toPublicRenderableForm, toRenderableForm, type Form } from "./forms";

const form = (): Form => ({
  id: "00000000-0000-0000-0000-000000000001",
  shortId: "abc12",
  tableId: "00000000-0000-0000-0000-000000000002",
  name: "Contact",
  config: {
    title: "Contact us",
    fields: [
      { kind: "user_input", fieldId: "00000000-0000-0000-0000-000000000003", label: "Email" },
      {
        kind: "user_input",
        fieldId: "00000000-0000-0000-0000-000000000006",
        label: "Company",
        inlineCreate: {
          enabled: true,
          fields: [{ fieldId: "00000000-0000-0000-0000-000000000007", label: "Company name", required: true }],
        },
      },
      { kind: "form_value", fieldId: "00000000-0000-0000-0000-000000000004", value: "website" },
    ],
    successMessage: "Thanks",
  },
  publicToken: "secret-token",
  isActive: true,
  ownerUserId: "00000000-0000-0000-0000-000000000005",
  position: 0,
  isDefault: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("form render DTOs", () => {
  test("raw config normalization preserves inline relation create settings", () => {
    expect(
      normalizeFormConfig({
        fields: [
          {
            kind: "user_input",
            fieldId: "00000000-0000-0000-0000-000000000006",
            label: "Company",
            inlineCreate: {
              enabled: true,
              fields: [
                {
                  fieldId: "00000000-0000-0000-0000-000000000007",
                  label: "Company name",
                  helpText: "Shown on invoices.",
                  required: true,
                },
              ],
            },
          },
        ],
      }).fields,
    ).toEqual([
      {
        kind: "user_input",
        fieldId: "00000000-0000-0000-0000-000000000006",
        label: "Company",
        inlineCreate: {
          enabled: true,
          fields: [
            {
              fieldId: "00000000-0000-0000-0000-000000000007",
              label: "Company name",
              helpText: "Shown on invoices.",
              required: true,
            },
          ],
        },
      },
    ]);
  });

  test("strip server-applied values from authenticated render forms", () => {
    const dto = toRenderableForm(form());

    expect(dto.publicToken).toBe(null);
    expect(dto.ownerUserId).toBe(null);
    expect(dto.config.fields).toEqual([
      { kind: "user_input", fieldId: "00000000-0000-0000-0000-000000000003", label: "Email" },
      {
        kind: "user_input",
        fieldId: "00000000-0000-0000-0000-000000000006",
        label: "Company",
        inlineCreate: {
          enabled: true,
          fields: [{ fieldId: "00000000-0000-0000-0000-000000000007", label: "Company name", required: true }],
        },
      },
    ]);
  });

  test("public render forms expose only the minimal anonymous shape", () => {
    const dto = toPublicRenderableForm(form());

    expect(Object.keys(dto).sort()).toEqual(["config", "id", "name"]);
    expect(dto.config.fields).toEqual([
      { kind: "user_input", fieldId: "00000000-0000-0000-0000-000000000003", label: "Email" },
      {
        kind: "user_input",
        fieldId: "00000000-0000-0000-0000-000000000006",
        label: "Company",
        inlineCreate: {
          enabled: true,
          fields: [{ fieldId: "00000000-0000-0000-0000-000000000007", label: "Company name", required: true }],
        },
      },
    ]);
  });
});
