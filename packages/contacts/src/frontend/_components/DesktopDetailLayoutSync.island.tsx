import { onCleanup, onMount } from "solid-js";
import { CONTACT_DETAIL_EVENT, getSelectedContactFromUrl, type ContactDetailPayload } from "./context";

type Props = {
  detailContainerId: string;
};

const hasSelection = (contactId: string | null, bookId: string | null) => Boolean(contactId && bookId);

const setDesktopDetailVisibility = (containerId: string, open: boolean) => {
  const detailContainer = document.getElementById(containerId);
  if (!detailContainer) return;

  if (open) {
    detailContainer.classList.remove("hidden");
    detailContainer.classList.add("flex");
    return;
  }

  detailContainer.classList.add("hidden");
  detailContainer.classList.remove("flex");
};

/**
 * Keeps the responsive detail panel visibility in sync with URL/detail selection state.
 */
export default function DesktopDetailLayoutSync(props: Props) {
  const syncFromUrl = () => {
    const selected = getSelectedContactFromUrl();
    setDesktopDetailVisibility(props.detailContainerId, hasSelection(selected.contactId, selected.bookId));
  };

  onMount(() => {
    const handleDetailSelect = (event: Event) => {
      const payload = (event as CustomEvent<ContactDetailPayload>).detail;
      setDesktopDetailVisibility(props.detailContainerId, hasSelection(payload.itemKey, payload.bookId));
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
