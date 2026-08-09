import { onCleanup, onMount } from "solid-js";
import { CONTACT_DETAIL_EVENT, type ContactDetailPayload, getSelectedContactFromUrl } from "./context";

type Props = {
  detailPanelId: string;
};

const hasSelection = (contactId: string | null, bookId: string | null) => Boolean(contactId && bookId);

export const setDesktopDetailVisibility = (panelId: string, open: boolean) => {
  const detailContainer = document.getElementById(`k2b-workspace-detail-${panelId}`);
  if (!detailContainer) return;
  detailContainer.hidden = !open;
};

/**
 * Keeps the responsive detail panel visibility in sync with URL/detail selection state.
 */
export default function DesktopDetailLayoutSync(props: Props) {
  const syncFromUrl = () => {
    const selected = getSelectedContactFromUrl();
    setDesktopDetailVisibility(props.detailPanelId, hasSelection(selected.contactId, selected.bookId));
  };

  onMount(() => {
    const handleDetailSelect = (event: Event) => {
      const payload = (event as CustomEvent<ContactDetailPayload>).detail;
      setDesktopDetailVisibility(props.detailPanelId, hasSelection(payload.itemKey, payload.bookId));
    };

    const handlePopState = () => syncFromUrl();

    syncFromUrl();
    window.addEventListener(CONTACT_DETAIL_EVENT, handleDetailSelect);
    window.addEventListener("popstate", handlePopState);

    onCleanup(() => {
      window.removeEventListener(CONTACT_DETAIL_EVENT, handleDetailSelect);
      window.removeEventListener("popstate", handlePopState);
    });
  });

  return null;
}
