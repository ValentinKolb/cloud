import { onCleanup, onMount } from "solid-js";
import { getDetailItemFromUrl, setDetailItemInUrl, shouldHandleDetailClick, subscribeToDetailSelection } from "../../../lib/detail";

type Props = {
  rootId: string;
};

/**
 * Delegates calendar item link clicks to client-side detail selection.
 * Keeps regular navigation behavior for non-item links.
 */
export default function CalendarDetailNavigation(props: Props) {
  onMount(() => {
    const root = document.getElementById(props.rootId);
    if (!root) return;
    const hoverClasses = ["hover:bg-zinc-200", "dark:hover:bg-zinc-700"];
    const activeClasses = ["!bg-blue-100", "dark:!bg-blue-900/30", "!hover:bg-blue-100", "dark:!hover:bg-blue-900/30"];

    const setActiveItem = (itemId: string | null) => {
      const links = root.querySelectorAll<HTMLAnchorElement>("a[data-space-item-id]");
      for (const link of Array.from(links)) {
        const active = !!itemId && link.dataset.spaceItemId === itemId;
        link.classList.remove("bg-blue-100", "dark:bg-blue-900/30");
        for (const className of hoverClasses) {
          link.classList.toggle(className, !active);
        }
        for (const className of activeClasses) {
          link.classList.toggle(className, active);
        }
      }
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a") as HTMLAnchorElement | null;
      if (!anchor || !root.contains(anchor)) return;
      if (!shouldHandleDetailClick(event, anchor)) return;

      const href = anchor.getAttribute("href");
      if (!href) return;
      const url = new URL(href, window.location.origin);
      if (url.pathname !== window.location.pathname) return;

      const itemId = url.searchParams.get("item");
      if (!itemId) return;

      event.preventDefault();
      setDetailItemInUrl(itemId);
    };

    root.addEventListener("click", onClick);
    const unsubscribe = subscribeToDetailSelection(({ itemId }) => setActiveItem(itemId));
    setActiveItem(getDetailItemFromUrl());

    onCleanup(() => {
      root.removeEventListener("click", onClick);
      unsubscribe();
    });
  });

  return null;
}
