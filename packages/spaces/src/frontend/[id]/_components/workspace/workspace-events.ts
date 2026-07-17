export const SPACES_DETAIL_NAVIGATION_EVENT = "spaces-detail-navigation";
export const SPACES_DETAIL_STATE_EVENT = "spaces-detail-state";
export const SPACES_DATA_INVALIDATED_EVENT = "spaces-data-invalidated";

export type SpacesDetailNavigation = {
  href: string;
  itemId: string | null;
  occurrenceId: string | null;
  history?: "push" | "replace" | "none";
  replace?: boolean;
};

export type SpacesDetailState = {
  itemId: string | null;
  occurrenceId: string | null;
  selectionId: string | null;
};

type SpacesDataDomain = "view" | "detail";
export type SpacesDataInvalidation = {
  domains: SpacesDataDomain[];
};

const routeKeyWithoutItem = (url: URL) => {
  const params = new URLSearchParams(url.search);
  params.delete("item");
  params.delete("occurrence");
  params.sort();
  return `${url.pathname}?${params.toString()}`;
};

export const resolveCalendarNavigationHref = (href: string, origin: string, expectedPath: string): string | null => {
  try {
    const target = new URL(href, origin);
    if (target.origin !== origin || target.pathname !== expectedPath) return null;
    return `${target.pathname}${target.search}`;
  } catch {
    return null;
  }
};

export const isDetailOnlySpacesNavigation = (currentHref: string, targetHref: string, origin: string) => {
  const current = new URL(currentHref, origin);
  const target = new URL(targetHref, origin);
  return target.origin === current.origin && routeKeyWithoutItem(target) === routeKeyWithoutItem(current);
};

export const publishSpacesDetailState = (detail: SpacesDetailState) => {
  window.dispatchEvent(new CustomEvent<SpacesDetailState>(SPACES_DETAIL_STATE_EVENT, { detail }));
};

export const requestSpacesDataRefresh = (domains: SpacesDataDomain[] = ["view", "detail"]) => {
  window.dispatchEvent(new CustomEvent<SpacesDataInvalidation>(SPACES_DATA_INVALIDATED_EVENT, { detail: { domains } }));
};

const publishDetailNavigation = (target: URL, history: "push" | "replace" | "none") => {
  window.dispatchEvent(
    new CustomEvent<SpacesDetailNavigation>(SPACES_DETAIL_NAVIGATION_EVENT, {
      detail: {
        href: `${target.pathname}${target.search}`,
        itemId: target.searchParams.get("item"),
        occurrenceId: target.searchParams.get("occurrence"),
        history,
      },
    }),
  );
};

/** Reconciles the detail island after another controller has already committed browser history. */
export const reconcileSpacesDetailRoute = (href: string) => {
  publishDetailNavigation(new URL(href, window.location.origin), "none");
};

/**
 * Enhances item-only URL changes. Every other route keeps a real document
 * navigation so the server remains the owner of shell and sidebar state.
 */
export const requestSpacesRouteNavigation = (href: string, options: { replace?: boolean; scroll?: unknown } = {}) => {
  const current = new URL(window.location.href);
  const target = new URL(href, window.location.origin);
  if (isDetailOnlySpacesNavigation(current.href, target.href, current.origin)) {
    publishDetailNavigation(target, options.replace ? "replace" : "push");
    return;
  }

  if (options.replace) window.location.replace(`${target.pathname}${target.search}`);
  else window.location.assign(`${target.pathname}${target.search}`);
};

export const requestCurrentSpacesRouteRefresh = (_options: { scroll?: unknown } = {}) => requestSpacesDataRefresh();
