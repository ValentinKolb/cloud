import type { RuntimeAppMeta } from "../contracts/app";
import { hasRole, type User } from "../contracts/shared";

export type VisibleNavigationApp = RuntimeAppMeta & {
  nav: NonNullable<RuntimeAppMeta["nav"]>;
};

/** Apps rendered in the navigation for a given authenticated user. */
export const visibleNavigationApps = (apps: readonly RuntimeAppMeta[], user: User | undefined): VisibleNavigationApp[] =>
  apps.filter(
    (app): app is VisibleNavigationApp =>
      !!app.nav &&
      app.nav.section !== "hidden" &&
      (!app.nav.requiresAuth || !!user) &&
      (!app.nav.requiresRoles ||
        !!user &&
          app.nav.requiresRoles.some((role) => {
            if (role === "guest") return user.profile === "guest";
            return hasRole(user, role);
          })),
  );
