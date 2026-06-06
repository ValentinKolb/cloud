import { type DetailSelectPayload, detailPanel } from "@valentinkolb/stdlib/solid";
import type { SpaceItem } from "@/contracts";

export const SPACE_DETAIL_PARAM = "item";
export const SPACE_ITEM_SELECT_EVENT = "space-item-select";

export const getDetailItemFromUrl = () => detailPanel.getUrlParam(SPACE_DETAIL_PARAM);

export const shouldHandleDetailClick = detailPanel.shouldHandleClick;

export const selectSpaceItemDetail = (item: SpaceItem | null, itemId: string | null) => {
  detailPanel.select(SPACE_DETAIL_PARAM, SPACE_ITEM_SELECT_EVENT, item, itemId);
};

export const shouldHandleItemEditDoubleClick = (event: MouseEvent) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  return !target.closest('button,input,select,textarea,[contenteditable]:not([contenteditable="false"]),[data-no-item-edit]');
};

type DetailChange = {
  itemId: string | null;
  item: SpaceItem | null;
  source: "event" | "popstate";
};

/**
 * Subscribe to spaces detail selection changes from both custom events and browser navigation.
 * Returns an unsubscribe function.
 */
export const subscribeToDetailSelection = (onChange: (change: DetailChange) => void) => {
  const onSelect = (event: Event) => {
    const payload = (event as CustomEvent<DetailSelectPayload<SpaceItem>>).detail;
    onChange({
      itemId: payload.itemKey ?? null,
      item: payload.item ?? null,
      source: "event",
    });
  };

  const onPopState = () => {
    onChange({
      itemId: getDetailItemFromUrl(),
      item: null,
      source: "popstate",
    });
  };

  window.addEventListener(SPACE_ITEM_SELECT_EVENT, onSelect);
  window.addEventListener("popstate", onPopState);

  return () => {
    window.removeEventListener(SPACE_ITEM_SELECT_EVENT, onSelect);
    window.removeEventListener("popstate", onPopState);
  };
};
