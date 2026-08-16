export const panesTabDropBeforeElementId = (
  pointerX: number,
  tabLeft: number,
  tabWidth: number,
  elementId: string,
  nextElementId?: string,
): string | null => (pointerX < tabLeft + tabWidth / 2 ? elementId : (nextElementId ?? null));

const VERTICAL_SPLIT_ENTER_DISTANCE = 24;
const VERTICAL_SPLIT_EXIT_DISTANCE = 12;

export const panesVerticalDragZone = (deltaY: number, previousZone: "top" | "bottom" | null): "top" | "bottom" | null => {
  if (previousZone === "top" && deltaY <= -VERTICAL_SPLIT_EXIT_DISTANCE) return "top";
  if (previousZone === "bottom" && deltaY >= VERTICAL_SPLIT_EXIT_DISTANCE) return "bottom";
  if (deltaY <= -VERTICAL_SPLIT_ENTER_DISTANCE) return "top";
  if (deltaY >= VERTICAL_SPLIT_ENTER_DISTANCE) return "bottom";
  return null;
};
