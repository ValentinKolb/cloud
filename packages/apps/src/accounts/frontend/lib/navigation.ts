/**
 * Returns the canonical current URL path + query (without hash).
 * Used as a deterministic alternative to location.reload().
 */
export const currentPathWithQuery = (): string => {
  const url = new URL(window.location.href);
  return `${url.pathname}${url.search}`;
};

/**
 * Navigates to the canonical current URL.
 */
export const refreshCurrentPath = (): void => {
  window.location.href = currentPathWithQuery();
};

/**
 * Navigates to a target href.
 */
export const navigateTo = (href: string): void => {
  window.location.href = href;
};
