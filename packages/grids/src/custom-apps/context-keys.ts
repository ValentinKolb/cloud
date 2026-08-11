import type { DslQueryContextKey } from "../query-dsl/parameters";
import type { CustomAppPage } from "./contracts";

const FIXED_APP_CONTEXT_KEYS = [
  "auth.id",
  "auth.name",
  "auth.username",
  "auth.email",
  "page.id",
  "page.title",
  "page.url",
  "app.id",
  "app.shortId",
  "app.name",
  "base.id",
  "base.name",
  "time.now",
  "time.today",
  "time.timeZone",
] as const satisfies readonly DslQueryContextKey[];

/** Return the exact implicit GQL and Markdown context available on one App page. */
export const customAppContextKeys = (page: CustomAppPage): DslQueryContextKey[] => [
  ...FIXED_APP_CONTEXT_KEYS,
  ...Object.keys(page.parameters).map((parameterId): DslQueryContextKey => `params.${parameterId}`),
];
