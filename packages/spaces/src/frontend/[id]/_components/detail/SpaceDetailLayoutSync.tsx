import { onCleanup, onMount } from "solid-js";
import { SPACE_ITEM_SELECT_EVENT, getDetailItemFromUrl } from "../../../lib/detail";
import type { SpaceItem } from "@/contracts";
import type { DetailSelectPayload } from "@valentinkolb/stdlib/solid";

type Props = {
  detailContainerId: string;
  forceOpen?: boolean;
};

const setDetailVisibility = (containerId: string, open: boolean) => {
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

export default function SpaceDetailLayoutSync(props: Props) {
  const syncFromUrl = () => {
    setDetailVisibility(props.detailContainerId, props.forceOpen === true || Boolean(getDetailItemFromUrl()));
  };

  onMount(() => {
    const handleDetailSelect = (event: Event) => {
      const payload = (event as CustomEvent<DetailSelectPayload<SpaceItem>>).detail;
      setDetailVisibility(props.detailContainerId, props.forceOpen === true || Boolean(payload.itemKey));
    };

    const handlePopState = () => syncFromUrl();

    syncFromUrl();
    window.addEventListener(SPACE_ITEM_SELECT_EVENT, handleDetailSelect);
    window.addEventListener("popstate", handlePopState);

    onCleanup(() => {
      window.removeEventListener(SPACE_ITEM_SELECT_EVENT, handleDetailSelect);
      window.removeEventListener("popstate", handlePopState);
    });
  });

  return null;
}
