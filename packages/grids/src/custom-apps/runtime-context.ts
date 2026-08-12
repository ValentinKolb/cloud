import type { DateContext } from "@k2b/stdlib";
import { dates } from "@k2b/stdlib";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import type { GridsAccessContext } from "../api/permissions";
import { accessActorUser } from "../api/permissions";
import type { DslQueryContextValues } from "../query-dsl/parameters";
import type { CustomAppDefinition } from "./contracts";

type RuntimeApp = { id: string; shortId: string; name: string };
type RuntimeBase = { id: string; name: string };
type RuntimePage = { id: string; title: string };

export type CustomAppRuntimeContext = {
  query: DslQueryContextValues;
  now: Date;
};

type GlobalRuntimeContextParams = {
  access: GridsAccessContext;
  app: RuntimeApp;
  base: RuntimeBase;
  dateConfig: DateContext;
  now?: Date;
};

/** Build app-global context. Page values are inert sentinels and are rejected by the global compiler contract. */
export const buildCustomAppGlobalRuntimeContext = (params: GlobalRuntimeContextParams): CustomAppRuntimeContext =>
  buildCustomAppRuntimeContext({
    ...params,
    page: { id: "global", title: params.app.name },
    pageUrl: `/apps/${encodeURIComponent(params.app.shortId)}`,
    pageParams: {},
  });

/** Capture every implicit GQL value once so all work in one request observes the same clock and URL. */
export const buildCustomAppRuntimeContext = (params: {
  access: GridsAccessContext;
  app: RuntimeApp;
  base: RuntimeBase;
  page: RuntimePage;
  pageUrl: string;
  pageParams: Readonly<Record<string, string>>;
  dateConfig: DateContext;
  now?: Date;
}): CustomAppRuntimeContext => {
  const now = params.now ?? new Date();
  const timeZone = normalizeTimeZone(params.dateConfig.timeZone, "UTC");
  const user = accessActorUser(params.access);
  return {
    now,
    query: {
      "auth.id": user?.id ?? null,
      "auth.name": user?.displayName ?? null,
      "auth.username": user?.uid ?? null,
      "auth.email": user?.mail ?? null,
      "page.id": params.page.id,
      "page.title": params.page.title,
      "page.url": params.pageUrl,
      "app.id": params.app.id,
      "app.shortId": params.app.shortId,
      "app.name": params.app.name,
      "base.id": params.base.id,
      "base.name": params.base.name,
      "time.now": now.toISOString(),
      "time.today": dates.formatDateKey(now, { ...params.dateConfig, timeZone }),
      "time.timeZone": timeZone,
      ...Object.fromEntries(Object.entries(params.pageParams).map(([name, value]) => [`params.${name}`, value])),
    },
  };
};

export const customAppDefinitionWithAvailableNavigation = (
  definition: CustomAppDefinition,
  availablePageIds: ReadonlySet<string>,
): CustomAppDefinition => ({
  ...definition,
  pages: definition.pages.filter((page) => !page.navigation.visible || availablePageIds.has(page.id)),
});
