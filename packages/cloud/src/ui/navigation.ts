/**
 * Browser-side navigation helpers — shared across every app's islands.
 *
 * Replaces the per-app `lib/navigation.ts` modules that all reimplemented the
 * same handful of `window.location` wrappers. Re-exported from the `cloud/ui`
 * barrel so consumers `import { navigateTo, refreshCurrentPath } from
 * "@valentinkolb/cloud/ui"`.
 */

/**
 * Returns the canonical current URL path + query (without hash).
 * Used as a deterministic refresh target after mutations — `location.reload()`
 * preserves hash and forces a network revalidation we don't always want.
 */
export const currentPathWithQuery = (): string => {
  const url = new URL(window.location.href);
  return `${url.pathname}${url.search}`;
};

/**
 * Navigates to the canonical current URL. Triggers full SSR re-render.
 */
export const refreshCurrentPath = (): void => {
  window.location.assign(currentPathWithQuery());
};

/**
 * Navigates to a target href via browser navigation (adds history entry).
 */
export const navigateTo = (href: string): void => {
  window.location.assign(href);
};

export type NavigationScrollMode = "top" | "preserve" | "manual";

export type ScrollSnapshot = {
  window: { x: number; y: number };
  regions: Array<{
    key: string;
    x: number;
    y: number;
  }>;
};

export type EnhancedNavigateOptions = {
  replace?: boolean;
  scroll?: NavigationScrollMode;
  scrollSnapshot?: ScrollSnapshot;
  viewTransition?: boolean;
};

const SCROLL_PRESERVE_SELECTOR = "[data-scroll-preserve]";

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => unknown;
};

export const startViewTransition = (callback: () => void | Promise<void>): void => {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition) {
    void callback();
    return;
  }
  doc.startViewTransition(callback);
};

const restoreRegionScroll = (snapshot: ScrollSnapshot): void => {
  for (const region of snapshot.regions) {
    const selector = `[data-scroll-preserve="${CSS.escape(region.key)}"]`;
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) continue;
    el.scrollLeft = region.x;
    el.scrollTop = region.y;
  }
};

/**
 * Captures window scroll and every keyed `[data-scroll-preserve]` region.
 *
 * Use stable keys, e.g. `data-scroll-preserve="notebook-sidebar"`, rather than
 * boolean values. The key lets scroll survive DOM replacement.
 */
export const captureScroll = (selector = SCROLL_PRESERVE_SELECTOR): ScrollSnapshot => ({
  window: { x: window.scrollX, y: window.scrollY },
  regions: Array.from(document.querySelectorAll<HTMLElement>(selector))
    .map((el) => ({
      key: el.dataset.scrollPreserve ?? "",
      x: el.scrollLeft,
      y: el.scrollTop,
    }))
    .filter((region) => region.key.length > 0),
});

/**
 * Restores a snapshot captured by `captureScroll`.
 *
 * By default both window and keyed scroll regions are restored. Pass
 * `{ window: false }` to restore only `[data-scroll-preserve]` regions.
 */
export const restoreScroll = (snapshot: ScrollSnapshot, options: { window?: boolean } = {}): void => {
  restoreRegionScroll(snapshot);
  if (options.window === false) return;
  window.scrollTo(snapshot.window.x, snapshot.window.y);
};

/**
 * Progressive navigation primitive for islands.
 *
 * This updates browser history without a document reload. For ordinary SSR page
 * navigation use `navigateTo`; use this only when the current island has already
 * updated its UI or is intentionally preserving the current DOM.
 *
 * Scroll behavior:
 * - `top`: move window to top, but restore keyed `[data-scroll-preserve]` regions
 * - `preserve`: restore window and keyed regions
 * - `manual`: do not restore anything; callers can use capture/restore helpers
 *
 * Enhanced navigations run inside `document.startViewTransition` when the
 * browser supports it. Pass `viewTransition: false` to opt out or when wrapping
 * a larger app-level state commit yourself.
 */
export const navigate = (href: string, options: EnhancedNavigateOptions = {}): void => {
  const scroll = options.scroll ?? "top";
  const snapshot = scroll === "manual" ? null : (options.scrollSnapshot ?? captureScroll());
  const url = new URL(href, window.location.href);
  const target = `${url.pathname}${url.search}${url.hash}`;

  const commit = () => {
    if (options.replace) window.history.replaceState(null, "", target);
    else window.history.pushState(null, "", target);

    if (!snapshot) return;
    restoreRegionScroll(snapshot);
    if (scroll === "preserve") {
      window.scrollTo(snapshot.window.x, snapshot.window.y);
      return;
    }
    window.scrollTo(0, 0);
  };

  if (options.viewTransition === false) {
    commit();
    return;
  }
  startViewTransition(commit);
};

export const documentNavigate = (href: string, options: { replace?: boolean } = {}): void => {
  if (options.replace) window.location.replace(href);
  else window.location.assign(href);
};
