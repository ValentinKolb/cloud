import { describe, expect, test } from "bun:test";
import { composeCropBounds, restoreMarkupFromCrop, transformMarkupForCrop } from "./markup";
import type { MarkupElement } from "./types";

const elements: MarkupElement[] = [
  {
    id: "stroke",
    kind: "stroke",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.8 },
    ],
    color: "#000",
    size: 0.01,
    opacity: 1,
  },
  { id: "outside", kind: "redaction", start: { x: 0, y: 0 }, end: { x: 0.1, y: 0.1 }, color: "#000" },
  { id: "shape", kind: "shape", shape: "arrow", start: { x: 0.4, y: 0.4 }, end: { x: 0.6, y: 0.6 }, color: "#f00", size: 0.02 },
  { id: "text", kind: "text", position: { x: 0.5, y: 0.5 }, text: "Review", color: "#00f", size: 0.03 },
];

describe("image markup", () => {
  test("transforms markup into crop coordinates without losing hidden elements", () => {
    const cropped = transformMarkupForCrop(elements, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 2);
    expect(cropped.map((element) => element.id)).toEqual(["stroke", "outside", "shape", "text"]);
    const stroke = cropped[0];
    expect(stroke?.kind).toBe("stroke");
    if (stroke?.kind === "stroke") {
      expect(stroke.points[0]?.x).toBeCloseTo(-0.1);
      expect(stroke.points[0]?.y).toBeCloseTo(-0.1);
      expect(stroke.points[1]?.x).toBeCloseTo(1.1);
      expect(stroke.points[1]?.y).toBeCloseTo(1.1);
      expect(stroke.size).toBeCloseTo(0.02);
    }
    const outside = cropped[1];
    expect(outside?.kind).toBe("redaction");
    if (outside?.kind === "redaction") {
      expect(outside.start.x).toBeCloseTo(-0.5);
      expect(outside.start.y).toBeCloseTo(-0.5);
      expect(outside.end.x).toBeCloseTo(-0.3);
      expect(outside.end.y).toBeCloseTo(-0.3);
    }
    const text = cropped[3];
    expect(text?.kind).toBe("text");
    if (text?.kind === "text") {
      expect(text.position.x).toBeCloseTo(0.5);
      expect(text.position.y).toBeCloseTo(0.5);
      expect(text.size).toBeCloseTo(0.06);
    }
  });

  test("restores markup added to a cropped image back to original coordinates", () => {
    const restored = restoreMarkupFromCrop(
      [{ id: "label", kind: "text", position: { x: 0.5, y: 0.5 }, text: "Here", color: "#000", size: 0.04 }],
      { x: 0.25, y: 0.1, w: 0.5, h: 0.4 },
      0.5,
    );
    const text = restored[0];
    expect(text?.kind).toBe("text");
    if (text?.kind === "text") {
      expect(text.position.x).toBeCloseTo(0.5);
      expect(text.position.y).toBeCloseTo(0.3);
      expect(text.size).toBeCloseTo(0.02);
    }
  });

  test("round-trips every element through crop and reset", () => {
    const crop = { x: 0.2, y: 0.15, w: 0.6, h: 0.7 };
    const restored = restoreMarkupFromCrop(transformMarkupForCrop(elements, crop, 1.5), crop, 1 / 1.5);
    const rounded = JSON.parse(JSON.stringify(restored, (_key, value) => (typeof value === "number" ? Number(value.toFixed(10)) : value)));
    expect(rounded).toEqual(elements);
  });

  test("composes repeated crop bounds", () => {
    expect(composeCropBounds({ x: 0.1, y: 0.2, w: 0.8, h: 0.6 }, { x: 0.25, y: 0.5, w: 0.5, h: 0.25 })).toEqual({
      x: 0.30000000000000004,
      y: 0.5,
      w: 0.4,
      h: 0.15,
    });
  });
});
