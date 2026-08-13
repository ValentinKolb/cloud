import type { DslQueryPreviewResponse, Field, GridRecord, RecordDisplayConfig } from "../contracts";
import type { CustomAppCapabilities, CustomAppPage, CustomAppRecordsBlock } from "../custom-apps/contracts";
import { createCustomAppFileToken } from "../custom-apps/file-token";
import { projectCustomAppRecord } from "../custom-apps/record-projection";
import { customAppRecordsDisplayFieldHash, isSafeInlineCardImageMimeType } from "../custom-apps/records-display-capability";
import type { DslQueryContextValues } from "../query-dsl/parameters";
import { decodeDslResultCursor, gqlResultFingerprint } from "../query-dsl/result-cursor";
import {
  customAppRecordRelationSnapshot,
  customAppRelationLabelFieldIdsByTableId,
  sameCustomAppRecordRelationSnapshot,
} from "./custom-app-record-relations";
import { executePublishedCustomAppQuery } from "./custom-app-runtime-query";
import { listByTable as listFields } from "./fields";
import { listFirstImagePreviews } from "./files";
import { ALL_RECORD_ACCESS } from "./record-access";
import { createReader } from "./record-read";
import { buildPinnedRelationLabelCache } from "./relation-labels";
import type { ExpansionViewer } from "./relations";
import type { GridFilePreview } from "./types";
import { get as getView } from "./views";

type RecordsCapability = CustomAppCapabilities["views"][number] | CustomAppCapabilities["recordQueries"][number];

export type PublishedCustomAppRecordsResult = {
  response: DslQueryPreviewResponse;
  primaryTableId: string;
  cards?: {
    displayConfig: RecordDisplayConfig;
    fields: Field[];
    records: GridRecord[];
    relationLabels: Record<string, string>;
    filePreviews: Record<string, Record<string, GridFilePreview & { contentToken: string }>>;
  };
};

/** Executes the exact published Records source used by SSR and row-action admission. */
export const executePublishedCustomAppRecords = async (input: {
  baseId: string;
  customAppId: string;
  publishedAt: string;
  page: CustomAppPage;
  pageParams: Readonly<Record<string, string>>;
  block: CustomAppRecordsBlock;
  capabilities: CustomAppCapabilities;
  context: DslQueryContextValues;
  signal: AbortSignal;
  timeZone: string;
  viewer: ExpansionViewer;
  viewerUserId: string | null;
  viewerServiceAccountId: string | null;
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
            ...(source.kind === "view"
              ? {
                  allowedFieldIds:
                    block.display.kind === "table"
                      ? block.display.columnIds
                      : "displayConfig" in capability
                        ? capability.displayConfig?.cards?.fieldIds
                        : undefined,
                }
              : {}),
          },
        }
      : {}),
    maxResultBytes: 512_000,
    labelRelationValues: true,
  });
  const primaryTableId = "primaryTableId" in capability ? capability.primaryTableId : capability.tableId;
  if (!response.ok || block.display.kind !== "cards" || source.kind !== "view" || !("displayConfig" in capability)) {
    return { response, primaryTableId };
  }
  const displayConfig = capability.displayConfig;
  const displayFieldHash = capability.displayFieldHash;
  if (displayConfig?.mode !== "cards" || !displayFieldHash) return null;
  const allFields = await listFields(primaryTableId);
  if (customAppRecordsDisplayFieldHash(displayConfig, allFields) !== displayFieldHash) return null;
  const fieldIds = displayConfig.cards?.fieldIds ?? [];
  const fieldsById = new Map(allFields.map((field) => [field.id, field]));
  const fields = fieldIds.flatMap((fieldId) => {
    const field = fieldsById.get(fieldId);
    return field ? [field] : [];
  });
  if (fields.length !== fieldIds.length) return null;
  const recordIds = response.rows.flatMap((row) => (row.recordId ? [row.recordId] : []));
  const records = await (await createReader(primaryTableId, { fields: allFields, recordAccess: ALL_RECORD_ACCESS })).getMany(recordIds);
  const allowedFieldIds = new Set(fieldIds);
  const resultValuesByRecordId = new Map(
    response.rows.flatMap((row) =>
      row.recordId
        ? [
            [
              row.recordId,
              Object.fromEntries(
                response.columns.flatMap((column) =>
                  column.fieldId && allowedFieldIds.has(column.fieldId) ? [[column.fieldId, row.values[column.key]]] : [],
                ),
              ),
            ] as const,
          ]
        : [],
    ),
  );
  const projectedRecords = records.map((record) => {
    const projected = projectCustomAppRecord(record, [...allowedFieldIds]);
    return { ...projected, data: { ...projected.data, ...resultValuesByRecordId.get(record.id) } };
  });
  const relationCapability = capability.relationLabels ?? [];
  const relationTargetTableIds = [...new Set(relationCapability.map((relation) => relation.targetTableId))];
  const targetFieldsByTableId = new Map(
    await Promise.all(relationTargetTableIds.map(async (tableId) => [tableId, await listFields(tableId)] as const)),
  );
  const liveRelationLabels = customAppRecordRelationSnapshot(fields, targetFieldsByTableId);
  if (!sameCustomAppRecordRelationSnapshot(relationCapability, liveRelationLabels)) return null;
  const relationTableIds = [primaryTableId, ...relationTargetTableIds];
  const relationLabels = await buildPinnedRelationLabelCache(
    projectedRecords,
    fields,
    customAppRelationLabelFieldIdsByTableId(relationCapability),
    {
      ...input.viewer,
      isAdmin: false,
      readableTableIds: new Set(relationTableIds),
      recordAccessByTableId: new Map(relationTableIds.map((tableId) => [tableId, ALL_RECORD_ACCESS])),
    },
  );
  const imageFieldId = displayConfig.cards?.imageFieldId;
  const previews = imageFieldId
    ? await listFirstImagePreviews({
        tableId: primaryTableId,
        recordIds,
        fieldIds: [imageFieldId],
      })
    : {};
  const secret = process.env.APP_SECRET?.trim();
  if (imageFieldId && !secret) throw new Error("APP_SECRET is required for Custom App file previews");
  const filePreviews = Object.fromEntries(
    Object.entries(previews).map(([recordId, byField]) => [
      recordId,
      Object.fromEntries(
        Object.entries(byField).flatMap(([fieldId, preview]) =>
          isSafeInlineCardImageMimeType(preview.mimeType)
            ? [
                [
                  fieldId,
                  {
                    ...preview,
                    contentToken: createCustomAppFileToken(
                      {
                        appId: input.customAppId,
                        publishedAt: input.publishedAt,
                        pageId: input.page.id,
                        blockId: block.id,
                        pageParams: { ...input.pageParams },
                        viewerUserId: input.viewerUserId,
                        viewerServiceAccountId: input.viewerServiceAccountId,
                        search: input.search ?? null,
                        cursor: input.cursor ?? null,
                        tableId: primaryTableId,
                        recordId,
                        fieldId,
                        fileId: preview.fileId,
                      },
                      secret!,
                    ),
                  },
                ],
              ]
            : [],
        ),
      ),
    ]),
  );
  return { response, primaryTableId, cards: { displayConfig, fields, records: projectedRecords, relationLabels, filePreviews } };
};
