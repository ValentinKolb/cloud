import { createEffect, createSignal, onCleanup } from "solid-js";
import { renderMarkupCanvas } from "./markup";
import type { MarkupElement, MarkupPoint, MarkupShapeKind, MarkupTool } from "./types";

type MarkupOverlayProps = {
  imageId: string;
  width: number;
  height: number;
  elements: MarkupElement[];
  active: boolean;
  tool: MarkupTool;
  shape: MarkupShapeKind;
  color: string;
  size: number;
  onCommit: (element: MarkupElement, imageId: string) => void;
  onText: (position: MarkupPoint, imageId: string) => void;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const pointDistance = (a: MarkupPoint, b: MarkupPoint) => Math.hypot(a.x - b.x, a.y - b.y);

export default function MarkupOverlay(props: MarkupOverlayProps) {
  const [draft, setDraft] = createSignal<MarkupElement | null>(null);
  let committedCanvas: HTMLCanvasElement | undefined;
  let draftCanvas: HTMLCanvasElement | undefined;
  let currentDraft: MarkupElement | null = null;
  let activePointer: number | null = null;
  let frame: number | null = null;
  let renderedImageId = props.imageId;

  const draw = (canvas: HTMLCanvasElement | undefined, elements: MarkupElement[]) => {
    if (!canvas || props.width <= 0 || props.height <= 0) return;
    if (canvas.width !== props.width) canvas.width = props.width;
    if (canvas.height !== props.height) canvas.height = props.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderMarkupCanvas(ctx, elements, canvas.width, canvas.height);
  };

  createEffect(() => draw(committedCanvas, props.elements));
  createEffect(() => {
    const current = draft();
    draw(draftCanvas, current ? [current] : []);
  });
  createEffect(() => {
    if (props.active) return;
    activePointer = null;
    currentDraft = null;
    setDraft(null);
  });
  createEffect(() => {
    const nextImageId = props.imageId;
    if (nextImageId === renderedImageId) return;
    renderedImageId = nextImageId;
    activePointer = null;
    currentDraft = null;
    setDraft(null);
  });

  const scheduleDraft = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      setDraft(currentDraft ? { ...currentDraft } : null);
    });
  };

  const pointFromEvent = (event: PointerEvent): MarkupPoint => {
    const rect = draftCanvas?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };

  const startDraft = (event: PointerEvent) => {
    if (!props.active || activePointer !== null || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    const position = pointFromEvent(event);
    if (props.tool === "text") {
      props.onText(position, props.imageId);
      return;
    }

    activePointer = event.pointerId;
    draftCanvas?.setPointerCapture(event.pointerId);
    const id = crypto.randomUUID();
    if (props.tool === "pen" || props.tool === "highlighter") {
      currentDraft = {
        id,
        kind: "stroke",
        points: [position],
        color: props.color,
        size: props.size,
        opacity: props.tool === "highlighter" ? 0.35 : 1,
      };
    } else if (props.tool === "redact") {
      currentDraft = { id, kind: "redaction", start: position, end: position, color: "#000000" };
    } else {
      currentDraft = { id, kind: "shape", shape: props.shape, start: position, end: position, color: props.color, size: props.size };
    }
    setDraft(currentDraft);
  };

  const moveDraft = (event: PointerEvent) => {
    if (event.pointerId !== activePointer || !currentDraft) return;
    event.preventDefault();
    const events = event.getCoalescedEvents?.() ?? [event];

    if (currentDraft.kind === "stroke") {
      const points = currentDraft.points;
      for (const nextEvent of events) {
        const point = pointFromEvent(nextEvent);
        const previous = points.at(-1);
        if (!previous || pointDistance(previous, point) >= 0.0015) points.push(point);
      }
    } else if (currentDraft.kind === "redaction" || currentDraft.kind === "shape") {
      currentDraft = { ...currentDraft, end: pointFromEvent(event) };
    }
    scheduleDraft();
  };

  const finishDraft = (event: PointerEvent, commit: boolean) => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    if (commit && currentDraft) {
      const position = pointFromEvent(event);
      if (currentDraft.kind === "stroke") {
        const previous = currentDraft.points.at(-1);
        if (!previous || pointDistance(previous, position) >= 0.0015) currentDraft.points.push(position);
      } else if (currentDraft.kind === "redaction" || currentDraft.kind === "shape") {
        currentDraft = { ...currentDraft, end: position };
      }
    }
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    const completed = currentDraft;
    activePointer = null;
    currentDraft = null;
    setDraft(null);

    if (!commit || !completed) return;
    if (completed.kind === "redaction" || completed.kind === "shape") {
      if (pointDistance(completed.start, completed.end) < 0.005) return;
    }
    props.onCommit(completed, renderedImageId);
  };

  onCleanup(() => {
    if (frame !== null) cancelAnimationFrame(frame);
  });

  return (
    <div class="pointer-events-none absolute inset-0">
      <canvas ref={committedCanvas} class="absolute inset-0 h-full w-full" aria-hidden="true" />
      <canvas
        ref={draftCanvas}
        class="absolute inset-0 h-full w-full touch-none"
        classList={{
          "pointer-events-auto cursor-crosshair": props.active,
          "pointer-events-none": !props.active,
        }}
        aria-label={props.active ? "Image markup canvas" : undefined}
        onPointerDown={startDraft}
        onPointerMove={moveDraft}
        onPointerUp={(event) => finishDraft(event, true)}
        onPointerCancel={(event) => finishDraft(event, false)}
        onLostPointerCapture={(event) => finishDraft(event, false)}
      />
    </div>
  );
}
