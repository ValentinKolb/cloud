/**
 * Returns the canonical current URL path + query (without hash).
 * Used as deterministic refresh target after notebook mutations.
 */
export const currentPathWithQuery = () => {
  const url = new URL(window.location.href);
  return `${url.pathname}${url.search}`;
};

/**
 * Navigates to the canonical current URL.
 */
export const refreshCurrentPath = () => {
  window.location.href = currentPathWithQuery();
};
