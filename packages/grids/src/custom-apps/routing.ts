import { z } from "zod";
import type { CustomAppDefinition, CustomAppPage, CustomAppRowNavigation } from "./contracts";

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

export const customAppPageHref = (shortId: string, pageId: string, params: Record<string, string> = {}): string => {
  const search = new URLSearchParams();
  for (const key of Object.keys(params).sort()) search.set(key, params[key]!);
  const query = search.toString();
  const path = `/apps/${encodeURIComponent(shortId)}/${encodeURIComponent(pageId)}`;
  return query ? `${path}?${query}` : path;
};

export const customAppRowHref = (shortId: string, navigation: CustomAppRowNavigation, recordId: string): string =>
  customAppPageHref(
    shortId,
    navigation.pageId,
    Object.fromEntries(Object.keys(navigation.params).map((parameterId) => [parameterId, recordId])),
  );
