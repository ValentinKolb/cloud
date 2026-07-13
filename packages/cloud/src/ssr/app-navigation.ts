import type { RuntimeAppMeta } from "../contracts/app";
import { hasRole, type User } from "../contracts/shared";

export type VisibleNavigationApp = RuntimeAppMeta & {
  nav: NonNullable<RuntimeAppMeta["nav"]>;
};

export type RuntimeRouteMatch = {
  app: RuntimeAppMeta;
  prefix: string;
};

/** Resolves the app owning the most specific registered prefix for a path. */
export const resolveRuntimeRoute = (apps: readonly RuntimeAppMeta[], pathname: string): RuntimeRouteMatch | undefined => {
  const path = pathname.split(/[?#]/, 1)[0] || "/";
  return apps
    .flatMap((app) => app.routes.map((prefix) => ({ app, prefix })))
    .filter(({ prefix }) => prefix === "/" || path === prefix || path.startsWith(`${prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
};

/** True when a path is owned by an app other than the current caller. */
export const hasDedicatedRuntimeRoute = (apps: readonly RuntimeAppMeta[], pathname: string, currentAppId: string): boolean => {
  const match = resolveRuntimeRoute(apps, pathname);
  return !!match && match.app.id !== currentAppId;
};

/** Apps rendered in the navigation for a given authenticated user. */
export const visibleNavigationApps = (apps: readonly RuntimeAppMeta[], user: User | undefined): VisibleNavigationApp[] =>
  apps.filter(
    (app): app is VisibleNavigationApp =>
      !!app.nav &&
      app.nav.section !== "hidden" &&
      (!app.nav.requiresAuth || !!user) &&
      (!app.nav.requiresRoles ||
        (!!user &&
          app.nav.requiresRoles.some((role) => {
            if (role === "guest") return user.profile === "guest";
            return hasRole(user, role);
          }))),
  );
