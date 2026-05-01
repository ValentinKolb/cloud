import { test, expect } from "bun:test";
import { fieldTypeRegistry, getHandler, isKnownFieldType, userWritableFieldTypes } from "./index";

test("registry: covers all Tier-1 types", () => {
  const expected = [
    "text", "longtext", "number", "decimal", "boolean", "date",
    "single-select", "multi-select", "rating",
    "autonumber", "created_at", "created_by", "updated_at", "updated_by",
  ];
  for (const t of expected) expect(t in fieldTypeRegistry).toBe(true);
});

test("getHandler: returns null for unknown types", () => {
  expect(getHandler("nonexistent")).toBeNull();
});

test("isKnownFieldType: discriminates", () => {
  expect(isKnownFieldType("text")).toBe(true);
  expect(isKnownFieldType("nonexistent")).toBe(false);
});

test("userWritableFieldTypes: excludes system fields", () => {
  const writable = userWritableFieldTypes();
  expect(writable).not.toContain("created_at");
  expect(writable).not.toContain("autonumber");
  expect(writable).toContain("text");
  expect(writable).toContain("decimal");
});

test("system fields refuse user input", () => {
  const sysTypes = ["created_at", "updated_at", "created_by", "updated_by", "autonumber"];
  for (const t of sysTypes) {
    const h = getHandler(t);
    expect(h).not.toBeNull();
    expect(h!.validate("anything", {}, false).ok).toBe(false);
  }
});
