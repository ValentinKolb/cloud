import { describe, expect, test } from "bun:test";
import { selectBadgeItems, selectBadgeStyle } from "./select-badge-utils";

const config = {
  options: [
    { id: "new", label: "New", color: "#3b82f6" },
    { id: "paid", label: "Paid", color: "#22c55e" },
  ],
};

describe("select badge helpers", () => {
  test("select maps stored id to option label and color", () => {
    expect(selectBadgeItems(["paid"], "select", config)).toEqual([{ id: "paid", label: "Paid", color: "#22c55e", known: true }]);
  });

  test("select maps ids in stored order", () => {
    expect(selectBadgeItems(["new", "paid"], "select", config).map((item) => item.label)).toEqual(["New", "Paid"]);
  });

  test("unknown options fall back to raw id", () => {
    expect(selectBadgeItems(["archived"], "select", config)).toEqual([{ id: "archived", label: "archived", known: false }]);
  });

  test("invalid values render as no badges", () => {
    expect(selectBadgeItems("new", "text", config)).toEqual([]);
    expect(selectBadgeItems("new", "select", config)).toEqual([]);
  });

  test("hex colors become soft badge styles", () => {
    expect(selectBadgeStyle("#3b82f6")).toMatchObject({
      "background-color": "rgba(59, 130, 246, 0.12)",
      "border-color": "rgba(59, 130, 246, 0.34)",
      color: "rgb(59, 130, 246)",
    });
    expect(selectBadgeStyle("not-a-color")).toEqual({});
  });
});
