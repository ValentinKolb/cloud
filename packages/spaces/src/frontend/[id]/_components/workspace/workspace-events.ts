export const SPACES_DETAIL_NAVIGATION_EVENT = "spaces-detail-navigation";
export const SPACES_DETAIL_STATE_EVENT = "spaces-detail-state";
export const SPACES_DATA_INVALIDATED_EVENT = "spaces-data-invalidated";

export type SpacesDetailNavigation = {
  href: string;
  itemId: string | null;
  replace?: boolean;
};

export type SpacesDetailState = {
  itemId: string | null;
};

type SpacesDataDomain = "view" | "detail";
export type SpacesDataInvalidation = {
  domains: SpacesDataDomain[];
};

const routeKeyWithoutItem = (url: URL) => {
  const params = new URLSearchParams(url.search);
  params.delete("item");
  params.sort();
  return `${url.pathname}?${params.toString()}`;
};

export const isDetailOnlySpacesNavigation = (currentHref: string, targetHref: string, origin: string) => {
  const current = new URL(currentHref, origin);
  const target = new URL(targetHref, origin);
  return target.origin === current.origin && routeKeyWithoutItem(target) === routeKeyWithoutItem(current);
};

export const publishSpacesDetailState = (itemId: string | null) => {
  window.dispatchEvent(new CustomEvent<SpacesDetailState>(SPACES_DETAIL_STATE_EVENT, { detail: { itemId } }));
};

export const requestSpacesDataRefresh = (domains: SpacesDataDomain[] = ["view", "detail"]) => {
  window.dispatchEvent(new CustomEvent<SpacesDataInvalidation>(SPACES_DATA_INVALIDATED_EVENT, { detail: { domains } }));
};

/**
 * Enhances item-only URL changes. Every other route keeps a real document
 * navigation so the server remains the owner of shell and sidebar state.
 */
export const requestSpacesRouteNavigation = (href: string, options: { replace?: boolean; scroll?: unknown } = {}) => {
  const current = new URL(window.location.href);
  const target = new URL(href, window.location.origin);
  if (isDetailOnlySpacesNavigation(current.href, target.href, current.origin)) {
    window.dispatchEvent(
      new CustomEvent<SpacesDetailNavigation>(SPACES_DETAIL_NAVIGATION_EVENT, {
        detail: { href: `${target.pathname}${target.search}`, itemId: target.searchParams.get("item"), replace: options.replace },
      }),
    );
    return;
  }

  if (options.replace) window.location.replace(`${target.pathname}${target.search}`);
  else window.location.assign(`${target.pathname}${target.search}`);
};

export const requestCurrentSpacesRouteRefresh = (_options: { scroll?: unknown } = {}) => requestSpacesDataRefresh();
