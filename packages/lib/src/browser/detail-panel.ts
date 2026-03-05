/**
 * Hybrid Detail Panel Helpers
 *
 * Generic utilities for implementing the Hybrid SSR + Client-Side Detail Panel pattern.
 * This pattern allows detail panels that:
 * - Are fully SSR-rendered on initial load (deep links work)
 * - Update client-side without page reload (preserves scroll position)
 * - Support browser back/forward navigation
 *
 * See docs/applayout-patterns.md for full documentation.
 */

import { createSignal, onMount, onCleanup, type Accessor } from "solid-js";

// =============================================================================
// Types
// =============================================================================

/** Payload for detail selection events */
export type DetailSelectPayload<T> = {
  item: T | null;
  itemKey: string | null;
};

/** Options for creating a detail panel controller */
export type DetailPanelOptions<T> = {
  /** URL parameter name (e.g., "item", "file") */
  paramName: string;
  /** Event name for selection changes */
  eventName: string;
  /** Initial item from SSR */
  initialItem: T | null;
  /** Initial item key from SSR */
  initialKey: string | null;
  /** All items for lookup on popstate */
  items: T[];
  /** Function to get the key from an item */
  getItemKey: (item: T) => string;
};

/** Return type of createDetailPanelController */
export type DetailPanelController<T> = {
  /** Current selected item (reactive) */
  item: Accessor<T | null>;
  /** Current item key (reactive) */
  itemKey: Accessor<string | null>;
};

// =============================================================================
// URL Helpers (without reload)
// =============================================================================

/**
 * Update URL parameter without page reload.
 * Uses history.replaceState to preserve scroll position.
 */
export function setUrlParam(paramName: string, value: string | null): void {
  const url = new URL(window.location.href);
  if (value) {
    url.searchParams.set(paramName, value);
  } else {
    url.searchParams.delete(paramName);
  }
  history.replaceState({}, "", url.toString());
}

/**
 * Get URL parameter value.
 */
export function getUrlParam(paramName: string): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get(paramName);
}

// =============================================================================
// Event Helpers
// =============================================================================

/**
 * Dispatch a detail selection event.
 * Call this when the user selects an item in a list.
 */
export function dispatchDetailSelect<T>(eventName: string, item: T | null, itemKey: string | null): void {
  window.dispatchEvent(
    new CustomEvent(eventName, {
      detail: { item, itemKey } as DetailSelectPayload<T>,
    }),
  );
}

/**
 * Combined helper: Update URL and dispatch event.
 * This is the main function to call when selecting an item.
 */
export function selectDetailItem<T>(paramName: string, eventName: string, item: T | null, itemKey: string | null): void {
  setUrlParam(paramName, itemKey);
  dispatchDetailSelect(eventName, item, itemKey);
}

/**
 * Returns true when a click should be handled as in-place detail selection
 * (plain primary click without modifier keys).
 */
export function shouldHandleDetailClick(event: MouseEvent, anchor?: HTMLAnchorElement | null): boolean {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor?.target && anchor.target !== "_self") return false;
  return true;
}

// =============================================================================
// SolidJS Hooks
// =============================================================================

/**
 * Create a reactive detail panel controller.
 *
 * This hook manages the state for a detail panel that:
 * - Initializes from SSR-provided values
 * - Listens for selection events from the list
 * - Handles browser back/forward navigation
 *
 * @example
 * ```tsx
 * const { item, itemKey } = createDetailPanelController({
 *   paramName: "user",
 *   eventName: "user-detail-select",
 *   initialItem: props.initialUser,
 *   initialKey: props.initialUserId,
 *   items: props.users,
 *   getItemKey: (user) => user.id,
 * });
 *
 * return (
 *   <Show when={item()} fallback={<EmptyState />}>
 *     {(user) => <UserDetails user={user()} />}
 *   </Show>
 * );
 * ```
 */
export function createDetailPanelController<T>(options: DetailPanelOptions<T>): DetailPanelController<T> {
  const { paramName, eventName, initialItem, initialKey, items, getItemKey } = options;

  const [item, setItem] = createSignal<T | null>(initialItem);
  const [itemKey, setItemKey] = createSignal<string | null>(initialKey);

  onMount(() => {
    // Listen for selection events from the list
    const handleSelect = (e: Event) => {
      const payload = (e as CustomEvent<DetailSelectPayload<T>>).detail;
      setItem(() => payload.item);
      setItemKey(payload.itemKey);
    };

    // Listen for browser back/forward navigation
    const handlePopState = () => {
      const key = getUrlParam(paramName);
      if (key) {
        const found = items.find((i) => getItemKey(i) === key);
        setItem(() => found ?? null);
        setItemKey(key);
      } else {
        setItem(() => null);
        setItemKey(null);
      }
    };

    window.addEventListener(eventName, handleSelect);
    window.addEventListener("popstate", handlePopState);

    onCleanup(() => {
      window.removeEventListener(eventName, handleSelect);
      window.removeEventListener("popstate", handlePopState);
    });
  });

  return { item, itemKey };
}

/**
 * Create a reactive selection state for a list component.
 *
 * This hook manages the highlighted state that syncs with detail panel selections.
 *
 * @example
 * ```tsx
 * const { selectedKey, select, deselect } = createDetailListController({
 *   paramName: "user",
 *   eventName: "user-detail-select",
 *   initialKey: props.selectedUserId,
 * });
 *
 * return (
 *   <For each={users}>
 *     {(user) => (
 *       <div
 *         classList={{ "bg-blue-100": selectedKey() === user.id }}
 *         onClick={() => select(user, user.id)}
 *       >
 *         {user.name}
 *       </div>
 *     )}
 *   </For>
 * );
 * ```
 */
export function createDetailListController<T>(options: { paramName: string; eventName: string; initialKey: string | null }): {
  selectedKey: Accessor<string | null>;
  select: (item: T, key: string) => void;
  deselect: () => void;
} {
  const { paramName, eventName, initialKey } = options;

  const [selectedKey, setSelectedKey] = createSignal<string | null>(initialKey);

  onMount(() => {
    // Listen for selection events (for cross-component sync)
    const handleSelect = (e: Event) => {
      const payload = (e as CustomEvent<DetailSelectPayload<T>>).detail;
      setSelectedKey(payload.itemKey);
    };

    window.addEventListener(eventName, handleSelect);
    onCleanup(() => window.removeEventListener(eventName, handleSelect));
  });

  const select = (item: T, key: string) => {
    setSelectedKey(key);
    selectDetailItem(paramName, eventName, item, key);
  };

  const deselect = () => {
    setSelectedKey(null);
    selectDetailItem(paramName, eventName, null, null);
  };

  return { selectedKey, select, deselect };
}

export const detailPanel = {
  setUrlParam,
  getUrlParam,
  dispatchDetailSelect,
  selectDetailItem,
  shouldHandleDetailClick,
  createDetailPanelController,
  createDetailListController,
} as const;
