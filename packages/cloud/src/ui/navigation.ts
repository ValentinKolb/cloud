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
