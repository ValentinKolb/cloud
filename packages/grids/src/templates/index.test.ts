import { describe, expect, test } from "bun:test";
import { templates } from ".";
import type { GridTemplate, TemplateRef } from "./types";

const isRef = (value: unknown): value is TemplateRef =>
  !!value &&
  typeof value === "object" &&
  typeof (value as Record<string, unknown>).$ref === "string" &&
  typeof (value as Record<string, unknown>).key === "string";

const refsIn = (value: unknown): TemplateRef[] => {
  if (isRef(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(refsIn);
  return [];
};

const indexTemplate = (template: GridTemplate) => {
  const tables = new Set(template.tables.map((table) => table.key));
  const fields = new Set(
    template.tables.flatMap((table) => table.fields.map((field) => `${table.key}.${field.key}`)),
  );
  const records = new Set((template.records ?? []).map((record) => record.key));
  const views = new Set((template.views ?? []).map((view) => view.key));
  const forms = new Set((template.forms ?? []).map((form) => form.key));
  const dashboards = new Set((template.dashboards ?? []).map((dashboard) => dashboard.key));
  return { tables, fields, records, views, forms, dashboards };
};

const assertUnique = (values: string[], label: string) => {
  expect(new Set(values).size, `${label} must be unique`).toBe(values.length);
};

describe("built-in grid templates", () => {
  test("template ids are unique", () => {
    assertUnique(templates.map((template) => template.id), "template ids");
  });

  test("all internal references resolve", () => {
    for (const template of templates) {
      const index = indexTemplate(template);
      assertUnique(template.tables.map((table) => table.key), `${template.id} table keys`);

      for (const table of template.tables) {
        assertUnique(table.fields.map((field) => field.key), `${template.id}.${table.key} field keys`);
      }

      for (const ref of refsIn(template)) {
        const target =
          ref.$ref === "table"
            ? index.tables
            : ref.$ref === "field"
              ? index.fields
              : ref.$ref === "record"
                ? index.records
                : ref.$ref === "view"
                  ? index.views
                  : ref.$ref === "form"
                    ? index.forms
                    : index.dashboards;
        expect(target.has(ref.key), `${template.id} missing ${ref.$ref}:${ref.key}`).toBe(true);
      }

      if (template.defaultDashboard) {
        expect(index.dashboards.has(template.defaultDashboard), `${template.id} defaultDashboard`).toBe(true);
      }
    }
  });
});
