import { z } from "zod";
import type { CustomAppAction, CustomAppDefinition, CustomAppFormBlock, CustomAppPage, CustomAppRowNavigation } from "./contracts";

const RecordIdSchema = z.string().uuid();

export const resolveCustomAppPage = (definition: CustomAppDefinition, requestedPageId?: string): CustomAppPage | null => {
  const pageId = requestedPageId || definition.startPageId;
  return definition.pages.find((page) => page.id === pageId) ?? null;
};

export const resolvePageRecordId = (page: CustomAppPage, query: Record<string, string>): string | null | undefined => {
  if (!page.record) return undefined;
  const value = query[page.record.id.path];
  if (!value) return null;
  const parsed = RecordIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const resolveCustomAppPageParams = (page: CustomAppPage, query: Record<string, string>): Record<string, string> | null => {
  const params: Record<string, string> = {};
  for (const parameterId of Object.keys(page.parameters)) {
    const value = query[parameterId];
    if (!value) return null;
    const parsed = RecordIdSchema.safeParse(value);
    if (!parsed.success) return null;
    params[parameterId] = parsed.data;
  }
  return params;
};

export const customAppPageHref = (shortId: string, pageId: string, params: Record<string, string> = {}): string => {
  const search = new URLSearchParams();
  for (const key of Object.keys(params).sort()) search.set(key, params[key]!);
  const query = search.toString();
  const path = `/apps/${encodeURIComponent(shortId)}/${encodeURIComponent(pageId)}`;
  return query ? `${path}?${query}` : path;
};

export const customAppFormSubmitUrl = (shortId: string, pageId: string, blockId: string, params: Record<string, string>): string => {
  const pageHref = customAppPageHref(shortId, pageId, params);
  const query = pageHref.includes("?") ? pageHref.slice(pageHref.indexOf("?")) : "";
  return `/api/grids/apps/runtime/${encodeURIComponent(shortId)}/${encodeURIComponent(pageId)}/${encodeURIComponent(blockId)}/submit${query}`;
};

export const customAppCommentsUrl = (shortId: string, pageId: string, blockId: string, params: Record<string, string>): string => {
  const pageHref = customAppPageHref(shortId, pageId, params);
  const query = pageHref.includes("?") ? pageHref.slice(pageHref.indexOf("?")) : "";
  return `/api/grids/apps/runtime/${encodeURIComponent(shortId)}/${encodeURIComponent(pageId)}/${encodeURIComponent(blockId)}/comments${query}`;
};

export const customAppRecordUpdateUrl = (shortId: string, pageId: string, blockId: string, params: Record<string, string>): string => {
  const pageHref = customAppPageHref(shortId, pageId, params);
  const query = pageHref.includes("?") ? pageHref.slice(pageHref.indexOf("?")) : "";
  return `/api/grids/apps/runtime/${encodeURIComponent(shortId)}/${encodeURIComponent(pageId)}/${encodeURIComponent(blockId)}/record${query}`;
};

export const customAppActionUrl = (shortId: string, pageId: string, blockId: string, actionId: string, params: Record<string, string>): string => {
  const pageHref = customAppPageHref(shortId, pageId, params);
  const query = pageHref.includes("?") ? pageHref.slice(pageHref.indexOf("?")) : "";
  return `/api/grids/apps/runtime/${encodeURIComponent(shortId)}/${encodeURIComponent(pageId)}/${encodeURIComponent(blockId)}/actions/${encodeURIComponent(actionId)}${query}`;
};

export const customAppActionHref = (
  shortId: string,
  action: Extract<CustomAppAction, { kind: "navigate" }>,
  pageParams: Record<string, string>,
  recordId?: string,
): string | null => {
  const params: Record<string, string> = {};
  for (const [parameterId, value] of Object.entries(action.params)) {
    const resolved = value.source === "PARAMS" ? pageParams[value.path] : recordId;
    if (!resolved) return null;
    params[parameterId] = resolved;
  }
  return customAppPageHref(shortId, action.pageId, params);
};

export const customAppRowHref = (shortId: string, navigation: CustomAppRowNavigation, recordId: string): string =>
  customAppPageHref(
    shortId,
    navigation.pageId,
    Object.fromEntries(Object.keys(navigation.params).map((parameterId) => [parameterId, recordId])),
  );

export const customAppFormSuccessHref = (
  shortId: string,
  navigation: NonNullable<CustomAppFormBlock["onSuccessNavigate"]>,
  pageParams: Record<string, string>,
  recordId: string,
): string =>
  customAppPageHref(
    shortId,
    navigation.pageId,
    Object.fromEntries(
      Object.entries(navigation.params).map(([parameterId, value]) => [
        parameterId,
        value.source === "RESULT" ? recordId : pageParams[value.path]!,
      ]),
    ),
  );
