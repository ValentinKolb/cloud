export type FloatingWindowRect = { x: number; y: number; width: number; height: number };

export const FLOATING_WINDOW_VIEWPORT_GAP = 16;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export const fitFloatingWindowRect = (
  rect: FloatingWindowRect,
  minWidth: number,
  minHeight: number,
  viewport: { width: number; height: number },
): FloatingWindowRect => {
  const maxWidth = Math.max(minWidth, viewport.width - FLOATING_WINDOW_VIEWPORT_GAP * 2);
  const maxHeight = Math.max(minHeight, viewport.height - FLOATING_WINDOW_VIEWPORT_GAP * 2);
  const width = clamp(rect.width, minWidth, maxWidth);
  const height = clamp(rect.height, minHeight, maxHeight);
  return {
    width,
    height,
    x: clamp(rect.x, FLOATING_WINDOW_VIEWPORT_GAP, viewport.width - width - FLOATING_WINDOW_VIEWPORT_GAP),
    y: clamp(rect.y, FLOATING_WINDOW_VIEWPORT_GAP, viewport.height - height - FLOATING_WINDOW_VIEWPORT_GAP),
  };
};
