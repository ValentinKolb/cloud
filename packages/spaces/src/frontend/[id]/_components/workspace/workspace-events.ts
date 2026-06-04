import type { NavigationScrollMode } from "@valentinkolb/ssr/nav";

export const SPACES_ROUTE_NAVIGATION_EVENT = "spaces-route-navigation";

export type SpacesRouteNavigationDetail = {
  href: string;
  replace?: boolean;
  scroll?: NavigationScrollMode;
};

export const currentSpacesHref = () => `${window.location.pathname}${window.location.search}`;

export const requestSpacesRouteNavigation = (href: string, options: Omit<SpacesRouteNavigationDetail, "href"> = {}) => {
  window.dispatchEvent(new CustomEvent<SpacesRouteNavigationDetail>(SPACES_ROUTE_NAVIGATION_EVENT, { detail: { href, ...options } }));
};

export const requestCurrentSpacesRouteRefresh = (options: Omit<SpacesRouteNavigationDetail, "href"> = {}) => {
  requestSpacesRouteNavigation(currentSpacesHref(), { replace: true, scroll: "preserve", ...options });
};
