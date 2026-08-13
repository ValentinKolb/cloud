import type { DslQueryContextKey } from "../query-dsl/parameters";
import type { CustomAppPage } from "./contracts";

const AUTH_CONTEXT_KEYS = [
  "auth.id",
  "auth.name",
  "auth.username",
  "auth.email",
  "auth.subjects",
] as const satisfies readonly DslQueryContextKey[];

const APP_BASE_TIME_CONTEXT_KEYS = [
  "app.id",
  "app.shortId",
  "app.name",
  "base.id",
  "base.name",
  "time.now",
  "time.today",
  "time.timeZone",
] as const satisfies readonly DslQueryContextKey[];

const PAGE_CONTEXT_KEYS = ["page.id", "page.title", "page.url"] as const satisfies readonly DslQueryContextKey[];

/** Context available to app-global sidebar actions. */
export const customAppGlobalContextKeys = (): DslQueryContextKey[] => [...AUTH_CONTEXT_KEYS, ...APP_BASE_TIME_CONTEXT_KEYS];

/** Return the exact implicit GQL and Markdown context available on one App page. */
export const customAppContextKeys = (page: CustomAppPage): DslQueryContextKey[] => [
  ...AUTH_CONTEXT_KEYS,
  ...PAGE_CONTEXT_KEYS,
  ...APP_BASE_TIME_CONTEXT_KEYS,
  ...Object.keys(page.parameters).map((parameterId): DslQueryContextKey => `params.${parameterId}`),
];
