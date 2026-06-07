import { expect, test } from "bun:test";
import {
  COMPUTED_FIELD_TYPES,
  EXTERNAL_FIELD_TYPES,
  LINK_FIELD_TYPES,
  SERVER_GENERATED_FIELD_TYPES,
  SYSTEM_FIELD_TYPES,
  VALUE_FIELD_TYPES,
  fieldTypeRegistry,
  getFieldType,
  getRecordWritableFieldType,
  isKnownFieldType,
  isRecordWritableFieldType,
  recordWritableFieldTypes,
} from "./index";

test("registry: covers all field kinds", () => {
  const expected = [
    "text",
    "longtext",
    "number",
    "boolean",
    "date",
    "select",
    "id",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
    "percent",
    "duration",
    "json",
    "file",
    "relation",
    "lookup",
    "rollup",
    "formula",
  ];
  for (const t of expected) expect(t in fieldTypeRegistry).toBe(true);
});

test("field kind registries separate write policies", () => {
  expect(VALUE_FIELD_TYPES.text?.kind).toBe("value");
  expect(LINK_FIELD_TYPES.relation?.kind).toBe("link");
  expect(SERVER_GENERATED_FIELD_TYPES.id?.kind).toBe("serverGenerated");
  expect(COMPUTED_FIELD_TYPES.formula?.kind).toBe("computed");
  expect(SYSTEM_FIELD_TYPES.created_at?.kind).toBe("system");
  expect(EXTERNAL_FIELD_TYPES.file?.kind).toBe("external");
});

test("getFieldType / getRecordWritableFieldType: discriminate by write policy", () => {
  expect(getFieldType("formula")?.kind).toBe("computed");
  expect(getFieldType("nonexistent")).toBeNull();
  expect(getRecordWritableFieldType("text")?.kind).toBe("value");
  expect(getRecordWritableFieldType("relation")?.kind).toBe("link");
  expect(getRecordWritableFieldType("formula")).toBeNull();
});

test("isKnownFieldType: discriminates", () => {
  expect(isKnownFieldType("text")).toBe(true);
  expect(isKnownFieldType("currency")).toBe(false);
  expect(isKnownFieldType("email")).toBe(false);
  expect(isKnownFieldType("nonexistent")).toBe(false);
});

test("recordWritableFieldTypes: includes value and link fields only", () => {
  const writable = recordWritableFieldTypes();
  expect(writable).not.toContain("created_at");
  expect(writable).not.toContain("id");
  expect(writable).not.toContain("formula");
  expect(writable).not.toContain("file");
  expect(writable).toContain("text");
  expect(writable).toContain("number");
  expect(writable).toContain("relation");
});

test("record writability is explicit", () => {
  expect(isRecordWritableFieldType("select")).toBe(true);
  expect(isRecordWritableFieldType("relation")).toBe(true);
  expect(isRecordWritableFieldType("lookup")).toBe(false);
  expect(isRecordWritableFieldType("updated_by")).toBe(false);
});
