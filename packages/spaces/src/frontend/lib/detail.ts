import { detailPanel } from "@valentinkolb/stdlib/solid";
import { SPACES_DETAIL_STATE_EVENT, type SpacesDetailState } from "../[id]/_components/workspace/workspace-events";

export const SPACE_DETAIL_PARAM = "item";

export const getDetailItemFromUrl = () => detailPanel.getUrlParam(SPACE_DETAIL_PARAM);
export const shouldHandleDetailClick = detailPanel.shouldHandleClick;

/** Subscribe to the single detail owner after it has committed URL state. */
export const subscribeToDetailSelection = (onChange: (change: { itemId: string | null }) => void) => {
  const onState = (event: Event) => onChange((event as CustomEvent<SpacesDetailState>).detail);
  window.addEventListener(SPACES_DETAIL_STATE_EVENT, onState);
  return () => window.removeEventListener(SPACES_DETAIL_STATE_EVENT, onState);
};

export const shouldHandleItemEditDoubleClick = (event: MouseEvent) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  return !target.closest('button,input,select,textarea,[contenteditable]:not([contenteditable="false"]),[data-no-item-edit]');
};
