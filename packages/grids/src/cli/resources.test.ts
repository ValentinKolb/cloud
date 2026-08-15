import { describe, expect, test } from "bun:test";
import { requirePublicId, resolveNamedResource } from "./resources";

const resource = {
  id: "Ab12C3",
  name: "Equipment",
};
const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("Grids CLI public IDs", () => {
  test("resolves only an exact name or the exact 6-character public id", () => {
    expect(resolveNamedResource([resource], "Equipment", "table")).toBe(resource);
    expect(resolveNamedResource([resource], "Ab12C3", "table")).toBe(resource);
    expect(() => resolveNamedResource([resource], "equipment", "table")).toThrow('Unknown table "equipment"');
    expect(() => resolveNamedResource([resource], "Ab12C", "table")).toThrow("Public ids contain exactly 6");
  });

  test("rejects private UUIDs and validates direct public-id arguments", () => {
    expect(() => resolveNamedResource([resource], uuid, "table")).toThrow("do not accept UUIDs");
    expect(requirePublicId("Ab12C3", "Table id")).toBe("Ab12C3");
    expect(() => requirePublicId("Ab12C", "Table id")).toThrow("must be a 6-character public id");
    expect(() => requirePublicId(uuid, "Table id")).toThrow("must be a 6-character public id");
  });
});
