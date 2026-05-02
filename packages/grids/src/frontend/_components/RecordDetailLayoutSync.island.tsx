import { onCleanup, onMount } from "solid-js";
import {
  RECORD_DETAIL_EVENT,
  getSelectedRecordIdFromUrl,
  type RecordDetailPayload,
} from "./record-detail-context";

type Props = {
  /** DOM id of the detail-panel container whose class we toggle. */
  detailContainerId: string;
};

/**
 * Tiny no-render island that keeps the detail-panel's `hidden`/`flex`
 * classes in sync with the `?record=<id>` URL param. Mirrors the spaces
 * `SpaceDetailLayoutSync` pattern: when the user clicks a row, the
 * RecordsGrid uses `history.replaceState` (no SSR re-run), so the SSR-
 * rendered container class is stale. This island flips the class
 * imperatively on the same selection event the panel itself listens to,
 * so the main column reclaims the freed space the moment the user
 * closes the panel — and yields it the moment they open one.
 */
export default function RecordDetailLayoutSync(props: Props) {
  const setVisibility = (open: boolean) => {
    const el = document.getElementById(props.detailContainerId);
    if (!el) return;
    if (open) {
      el.classList.remove("hidden");
      el.classList.add("flex");
    } else {
      el.classList.add("hidden");
      el.classList.remove("flex");
    }
  };

  const syncFromUrl = () => setVisibility(Boolean(getSelectedRecordIdFromUrl()));

  onMount(() => {
    const onSelect = (event: Event) => {
      const payload = (event as CustomEvent<RecordDetailPayload>).detail;
      setVisibility(Boolean(payload.itemKey));
    };
    const onPop = () => syncFromUrl();

    syncFromUrl();
    window.addEventListener(RECORD_DETAIL_EVENT, onSelect);
    window.addEventListener("popstate", onPop);

    onCleanup(() => {
      window.removeEventListener(RECORD_DETAIL_EVENT, onSelect);
      window.removeEventListener("popstate", onPop);
    });
  });

  return null;
}
