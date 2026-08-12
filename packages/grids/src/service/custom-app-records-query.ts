import type { DslQueryPreviewResponse } from "../contracts";
import type { CustomAppCapabilities, CustomAppPage, CustomAppRecordsBlock } from "../custom-apps/contracts";
import type { DslQueryContextValues } from "../query-dsl/parameters";
import { decodeDslResultCursor, gqlResultFingerprint } from "../query-dsl/result-cursor";
import { executePublishedCustomAppQuery } from "./custom-app-runtime-query";
import type { ExpansionViewer } from "./relations";
import { get as getView } from "./views";

type RecordsCapability = CustomAppCapabilities["views"][number] | CustomAppCapabilities["recordQueries"][number];

export type PublishedCustomAppRecordsResult = {
  response: DslQueryPreviewResponse;
  primaryTableId: string;
};

/** Executes the exact published Records source used by SSR and row-action admission. */
export const executePublishedCustomAppRecords = async (input: {
  baseId: string;
  page: CustomAppPage;
  block: CustomAppRecordsBlock;
  capabilities: CustomAppCapabilities;
  context: DslQueryContextValues;
  signal: AbortSignal;
  timeZone: string;
  viewer: ExpansionViewer;
  search?: string;
  cursor?: string;
}): Promise<PublishedCustomAppRecordsResult | null> => {
  const { block } = input;
  const source = block.source;
  const view = source.kind === "view" ? await getView(source.viewId) : null;
  const capability: RecordsCapability | undefined =
    source.kind === "view"
      ? input.capabilities.views.find((candidate) => candidate.viewId === source.viewId && candidate.tableId === view?.tableId)
      : input.capabilities.recordQueries.find((candidate) => candidate.pageId === input.page.id && candidate.blockId === block.id);
  if (!capability) return null;

  const search = block.searchable ? input.search?.trim().slice(0, 200) || undefined : undefined;
  const cursorSigningKey = process.env.APP_SECRET?.trim();
  if (!cursorSigningKey) throw new Error("APP_SECRET is required for Custom App Records pagination");
  const cursorFingerprint = gqlResultFingerprint({
    baseId: input.baseId,
    canonicalSource: `${capability.planHash}\0${search ?? ""}\0${block.pageSize}`,
    scope: `custom-app-records:${input.page.id}:${block.id}`,
  });
  const cursor = input.cursor ? decodeDslResultCursor(input.cursor, cursorSigningKey) : null;
  if (input.cursor && (!cursor || cursor.fingerprint !== cursorFingerprint || cursor.pageSize !== block.pageSize)) {
    return {
      primaryTableId: "primaryTableId" in capability ? capability.primaryTableId : capability.tableId,
      response: { ok: false, diagnostics: [{ message: "This result cursor is invalid or no longer matches the search." }] },
    };
  }

  const response = await executePublishedCustomAppQuery({
    baseId: input.baseId,
    source: view?.source ?? (source.kind === "gql" ? source.query : ""),
    capability,
    context: input.context,
    signal: input.signal,
    timeZone: input.timeZone,
    viewer: input.viewer,
    ...(view ? { currentTableId: view.tableId, sourceHashScope: view.tableId } : {}),
    maxRows: 100,
    pageSize: block.pageSize,
    cursor,
    cursorFingerprint,
    cursorSigningKey,
    ...(search
      ? {
          search: {
            q: search,
            ...(source.kind === "view" ? { allowedFieldIds: block.display.columnIds } : {}),
          },
        }
      : {}),
    maxResultBytes: 512_000,
    labelRelationValues: true,
  });
  return { response, primaryTableId: "primaryTableId" in capability ? capability.primaryTableId : capability.tableId };
};
