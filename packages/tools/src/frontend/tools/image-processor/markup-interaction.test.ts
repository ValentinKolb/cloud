import { describe, expect, test } from "bun:test";
import {
  findMarkupAtPoint,
  markupBounds,
  markupElementsEqual,
  markupHandles,
  resizeMarkupElement,
  strokeIdsAtPoint,
  translateMarkupElement,
  translateMarkupElementInCanvas,
} from "./markup-interaction";
import type { MarkupElement } from "./types";

const stroke: MarkupElement = {
  id: "stroke",
  kind: "stroke",
  points: [
    { x: 0.1, y: 0.2 },
    { x: 0.8, y: 0.2 },
  ],
  color: "#f00",
  size: 0.01,
  opacity: 1,
};
const rectangle: MarkupElement = {
  id: "rectangle",
  kind: "shape",
  shape: "rectangle",
  start: { x: 0.2, y: 0.3 },
  end: { x: 0.6, y: 0.7 },
  color: "#0f0",
  size: 0.01,
};
const text: MarkupElement = {
  id: "text",
  kind: "text",
  position: { x: 0.4, y: 0.4 },
  text: "Review",
  color: "#00f",
  size: 0.05,
};

describe("markup interaction geometry", () => {
  test("hits the topmost element and respects stroke distance", () => {
    expect(findMarkupAtPoint([stroke, rectangle], { x: 0.4, y: 0.4 }, 1_000, 1_000)?.id).toBe("rectangle");
    expect(findMarkupAtPoint([stroke], { x: 0.4, y: 0.205 }, 1_000, 1_000)?.id).toBe("stroke");
    expect(findMarkupAtPoint([stroke], { x: 0.4, y: 0.3 }, 1_000, 1_000)).toBeNull();
  });

  test("finds only strokes for the object eraser", () => {
    expect(strokeIdsAtPoint([rectangle, stroke], { x: 0.4, y: 0.2 }, 1_000, 1_000)).toEqual(["stroke"]);
    expect(strokeIdsAtPoint([rectangle], { x: 0.4, y: 0.4 }, 1_000, 1_000)).toEqual([]);
  });

  test("translates every geometry kind without mutating the original", () => {
    const movedStroke = translateMarkupElement(stroke, { x: 0.1, y: -0.05 });
    expect(movedStroke.kind === "stroke" ? movedStroke.points[0] : null).toEqual({ x: 0.2, y: 0.15000000000000002 });
    expect(stroke.kind === "stroke" ? stroke.points[0] : null).toEqual({ x: 0.1, y: 0.2 });
    const movedText = translateMarkupElement(text, { x: -0.1, y: 0.2 });
    expect(movedText.kind === "text" ? movedText.position : null).toEqual({ x: 0.30000000000000004, y: 0.6000000000000001 });

    const redaction: MarkupElement = {
      id: "redaction",
      kind: "redaction",
      start: { x: 0.1, y: 0.1 },
      end: { x: 0.3, y: 0.2 },
      color: "#000",
    };
    const movedRedaction = translateMarkupElement(redaction, { x: 0.2, y: 0.3 });
    expect(movedRedaction.kind === "redaction" ? [movedRedaction.start, movedRedaction.end] : null).toEqual([
      { x: 0.30000000000000004, y: 0.4 },
      { x: 0.5, y: 0.5 },
    ]);

    const movedRectangle = translateMarkupElement(rectangle, { x: -0.1, y: 0.1 });
    expect(movedRectangle.kind === "shape" ? [movedRectangle.start, movedRectangle.end] : null).toEqual([
      { x: 0.1, y: 0.4 },
      { x: 0.5, y: 0.7999999999999999 },
    ]);
  });

  test("resizes rectangles, arrows, circles, and text", () => {
    const resizedRectangle = resizeMarkupElement(rectangle, "se", { x: 0.8, y: 0.9 }, 1_000, 1_000);
    expect(resizedRectangle.kind === "shape" ? resizedRectangle.end : null).toEqual({ x: 0.8, y: 0.9 });

    const arrow: MarkupElement = { ...rectangle, id: "arrow", shape: "arrow" };
    const resizedArrow = resizeMarkupElement(arrow, "end", { x: 0.9, y: 0.1 }, 1_000, 1_000);
    expect(resizedArrow.kind === "shape" ? resizedArrow.end : null).toEqual({ x: 0.9, y: 0.1 });

    const circle: MarkupElement = { ...rectangle, id: "circle", shape: "circle" };
    const resizedCircle = resizeMarkupElement(circle, "end", { x: 0.7, y: 0.3 }, 1_000, 1_000);
    expect(resizedCircle.kind === "shape" ? resizedCircle.end : null).toEqual({ x: 0.7, y: 0.3 });

    const resizedText = resizeMarkupElement(text, "size", { x: 0.9, y: 0.8 }, 1_000, 1_000);
    expect(resizedText.kind === "text" ? resizedText.size : 0).toBeGreaterThan(text.kind === "text" ? text.size : 0);
  });

  test("keeps previously visible elements inside the canvas while moving", () => {
    const moved = translateMarkupElementInCanvas(rectangle, { x: 1, y: -1 }, 1_000, 1_000);
    const bounds = markupBounds(moved, 1_000, 1_000);
    expect(bounds.x + bounds.w).toBeCloseTo(1);
    expect(bounds.y).toBeCloseTo(0);
  });

  test("distinguishes real element changes from no-op interactions", () => {
    expect(markupElementsEqual(rectangle, { ...rectangle })).toBe(true);
    expect(markupElementsEqual(rectangle, { ...rectangle, end: { x: 0.7, y: 0.7 } })).toBe(false);
    expect(markupElementsEqual(stroke, { ...stroke, points: stroke.points.map((point) => ({ ...point })) })).toBe(true);
    expect(markupElementsEqual(stroke, { ...stroke, points: [...stroke.points, { x: 0.9, y: 0.2 }] })).toBe(false);
  });

  test("returns bounds and handles for selectable elements", () => {
    expect(markupBounds(rectangle, 1_000, 1_000)).toEqual({ x: 0.195, y: 0.295, w: 0.41, h: 0.41 });
    expect(markupHandles(rectangle, 1_000, 1_000).map((handle) => handle.id)).toEqual(["nw", "ne", "sw", "se"]);
    expect(markupHandles(text, 1_000, 1_000).map((handle) => handle.id)).toEqual(["size"]);
    expect(markupHandles(stroke, 1_000, 1_000)).toEqual([]);
  });
});
