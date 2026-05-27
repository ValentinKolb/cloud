export const SPACES_ROUTE_NAVIGATION_EVENT = "spaces-route-navigation";

export type SpacesRouteNavigationDetail = {
  href: string;
};

export const requestSpacesRouteNavigation = (href: string) => {
  window.dispatchEvent(new CustomEvent<SpacesRouteNavigationDetail>(SPACES_ROUTE_NAVIGATION_EVENT, { detail: { href } }));
};
