import { describe, expect, test } from "bun:test";
import { panesTabDropBeforeElementId, panesVerticalDragZone } from "./panes-dnd";

describe("Panes tab drop positions", () => {
  test("maps both tab halves to the surrounding insertion slots", () => {
    expect(panesTabDropBeforeElementId(124, 100, 50, "two", "three")).toBe("two");
    expect(panesTabDropBeforeElementId(125, 100, 50, "two", "three")).toBe("three");
  });

  test("maps the trailing half of the final tab to the end of the strip", () => {
    expect(panesTabDropBeforeElementId(150, 100, 50, "three")).toBeNull();
  });

  test("requires a deliberate vertical pull and keeps the split intent stable", () => {
    expect(panesVerticalDragZone(-23, null)).toBeNull();
    expect(panesVerticalDragZone(-24, null)).toBe("top");
    expect(panesVerticalDragZone(-13, "top")).toBe("top");
    expect(panesVerticalDragZone(-11, "top")).toBeNull();

    expect(panesVerticalDragZone(23, null)).toBeNull();
    expect(panesVerticalDragZone(24, null)).toBe("bottom");
    expect(panesVerticalDragZone(13, "bottom")).toBe("bottom");
    expect(panesVerticalDragZone(11, "bottom")).toBeNull();
  });
});
