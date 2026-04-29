import type { AppRegistryEntry } from "@valentinkolb/cloud/contracts";

// ─── Route table from registry ──────────────────────────────────────────────
//
// Each app declares its own top-level URL prefixes via `defineApp({ routes })`.
// The gateway is dumb: it just builds a longest-prefix-match trie from the
// declared strings and proxies to the right `baseUrl`. No derivation, no
// special cases — apps own the convention, the gateway owns nothing.
//
// Standard apps follow a four-prefix convention (`/api/<id>`, `/app/<id>`,
// `/admin/<id>`, `/public/<id>`). Specials (core, oauth, settings) list
// whatever top-level paths they actually own (e.g. `/auth`, `/oauth`,
// `/.well-known/openid-configuration`, `/legal/terms`, `/`).

export type AppRoute = { prefix: string; appId: string; baseUrl: string };

export const buildAppRoutes = (apps: AppRegistryEntry[]): AppRoute[] =>
  apps
    .filter((app) => app.id !== "gateway")
    .flatMap((app) => app.routes.map((prefix) => ({ prefix, appId: app.id, baseUrl: app.baseUrl })));
