import { runWithQueryAdmissionSignal } from "../api/query-admission";
import type { DslQueryPreviewResponse } from "../contracts";
import { customAppViewSourceHash } from "../custom-apps/insight-source";
import type { DslQueryContextValues } from "../query-dsl/parameters";
import { previewDslQuery } from "../query-dsl/preview";
import { collectDslPlanTableIds } from "../query-dsl/source-plan";
import { compileCustomAppQuery } from "./custom-app-query";
import { ALL_RECORD_ACCESS } from "./record-access";
import type { ExpansionViewer } from "./relations";

type PublishedQueryCapability = {
  sourceHash?: string;
  planHash: string;
  tableIds: readonly string[];
};

const diagnostic = (message: string): DslQueryPreviewResponse => ({ ok: false, diagnostics: [{ message }] });
const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  [...left].sort().join("\0") === [...right].sort().join("\0");

/**
 * Execute only a source loaded from an immutable published definition. This is
 * intentionally a server-only service: callers cannot submit arbitrary GQL.
 */
export const executePublishedCustomAppQuery = async (params: {
  baseId: string;
  source: string;
  capability: PublishedQueryCapability;
  context: DslQueryContextValues;
  signal: AbortSignal;
  timeZone: string;
  viewer: ExpansionViewer;
  currentTableId?: string;
  sourceHashScope?: string;
  maxRows: number;
  maxResultBytes: number;
  labelRelationValues?: boolean;
}): Promise<DslQueryPreviewResponse> => {
  if (
    params.capability.sourceHash &&
    customAppViewSourceHash(params.sourceHashScope ?? params.baseId, params.source) !== params.capability.sourceHash
  ) {
    return diagnostic("This published data source no longer matches its capability snapshot.");
  }

  const compiled = await compileCustomAppQuery({
    baseId: params.baseId,
    source: params.source,
    context: params.context,
    ...(params.currentTableId ? { currentTableId: params.currentTableId } : {}),
  });
  if (!compiled.ok) return diagnostic(compiled.error);
  if (compiled.data.planHash !== params.capability.planHash) {
    return diagnostic("This published data source no longer matches its query plan capability snapshot.");
  }

  const planTableIds = collectDslPlanTableIds(compiled.data.plan, compiled.data.fieldsByTableId);
  if (!sameIds(planTableIds, params.capability.tableIds)) {
    return diagnostic("This published data source no longer matches its table capability snapshot.");
  }

  const trustedRecordAccess = new Map(params.capability.tableIds.map((tableId) => [tableId, ALL_RECORD_ACCESS] as const));
  const result = await runWithQueryAdmissionSignal(params.signal, (signal) =>
    previewDslQuery(compiled.data.plan, {
      fieldsByTableId: compiled.data.fieldsByTableId,
      timeZone: params.timeZone,
      maxRows: params.maxRows,
      pageSize: params.maxRows,
      limit: params.maxRows,
      maxResultBytes: params.maxResultBytes,
      signal,
      labelRelationValues: params.labelRelationValues,
      viewer: {
        ...params.viewer,
        isAdmin: false,
        readableTableIds: new Set(params.capability.tableIds),
        recordAccessByTableId: new Map(trustedRecordAccess),
      },
      authorizedRecordAccessByTableId: trustedRecordAccess,
      primaryRecordAccess: ALL_RECORD_ACCESS,
    }),
  );
  return result.ok ? result.data : diagnostic(result.error.message);
};

export const publishedCustomAppAvailability = async (
  params: Omit<Parameters<typeof executePublishedCustomAppQuery>[0], "maxRows" | "maxResultBytes" | "labelRelationValues">,
): Promise<boolean> => {
  try {
    const response = await executePublishedCustomAppQuery({ ...params, maxRows: 1, maxResultBytes: 64_000 });
    return response.ok && response.rows.length > 0;
  } catch {
    return false;
  }
};
