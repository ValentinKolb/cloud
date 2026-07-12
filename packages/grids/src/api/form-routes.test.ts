import { describe, expect, test } from "bun:test";
import { err, fail, ok } from "@valentinkolb/stdlib";
import { createAuthenticatedFormRoutes } from "./form-authenticated-routes";
import { createPublicFormRoutes } from "./form-public-routes";
import formsRoutes from "./forms";

const baseId = "11111111-1111-4111-8111-111111111111";
const tableId = "22222222-2222-4222-8222-222222222222";
const formId = "33333333-3333-4333-8333-333333333333";

const form = {
  id: formId,
  shortId: "abcde",
  tableId,
  name: "Intake",
  config: {
    title: "Public intake",
    fields: [
      { kind: "user_input", fieldId: "44444444-4444-4444-8444-444444444444" },
      { kind: "form_value", fieldId: "55555555-5555-4555-8555-555555555555", value: "secret" },
    ],
  },
  publicToken: "token",
  isActive: true,
  ownerUserId: null,
  position: 0,
  isDefault: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("public form routes", () => {
  test("keeps management routes behind parent auth", async () => {
    expect((await formsRoutes.request(`/by-table/${tableId}`)).status).toBe(401);
  });

  test("returns 404 for an unknown token", async () => {
    const app = createPublicFormRoutes({ getByPublicToken: async () => null });
    const response = await app.request("/public/missing");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Form not found" });
  });

  test("returns only public render fields", async () => {
    const app = createPublicFormRoutes({ getByPublicToken: async () => form as never });
    const response = await app.request("/public/token");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: formId,
      name: "Intake",
      config: {
        title: "Public intake",
        fields: [{ kind: "user_input", fieldId: "44444444-4444-4444-8444-444444444444" }],
      },
    });
  });
});

describe("authenticated form routes", () => {
  const service = {
    table: { get: async (id: string) => (id === tableId ? { id: tableId, baseId } : null) },
    form: {
      listForTable: async () => [form],
    },
  };

  test("returns 404 for an unknown table", async () => {
    const app = createAuthenticatedFormRoutes({ service: service as never });
    const response = await app.request(`/by-table/${baseId}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Table not found" });
  });

  test("denies list access without table read", async () => {
    const app = createAuthenticatedFormRoutes({
      service: service as never,
      gate: async () => fail(err.forbidden("Forbidden")),
    });
    const response = await app.request(`/by-table/${tableId}`);

    expect(response.status).toBe(403);
  });

  test("lists forms for a readable table", async () => {
    const app = createAuthenticatedFormRoutes({
      service: service as never,
      gate: async () => ok("read"),
    });
    const response = await app.request(`/by-table/${tableId}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([form]);
  });
});
