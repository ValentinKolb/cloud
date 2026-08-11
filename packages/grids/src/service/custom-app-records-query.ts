import type { DslQueryPreviewResponse } from "../contracts";
import type { CustomAppCapabilities, CustomAppPage, CustomAppRecordsBlock } from "../custom-apps/contracts";
import type { DslQueryContextValues } from "../query-dsl/parameters";
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
}): Promise<PublishedCustomAppRecordsResult | null> => {
  const { block } = input;
  const source = block.source;
  const view = source.kind === "view" ? await getView(source.viewId) : null;
  const capability: RecordsCapability | undefined =
    source.kind === "view"
      ? input.capabilities.views.find((candidate) => candidate.viewId === source.viewId && candidate.tableId === view?.tableId)
      : input.capabilities.recordQueries.find((candidate) => candidate.pageId === input.page.id && candidate.blockId === block.id);
  if (!capability) return null;

  const response = await executePublishedCustomAppQuery({
    baseId: input.baseId,
    source: view?.source ?? (source.kind === "gql" ? source.query : ""),
    capability,
    context: input.context,
    signal: input.signal,
    timeZone: input.timeZone,
    viewer: input.viewer,
    ...(view ? { currentTableId: view.tableId, sourceHashScope: view.tableId } : {}),
    maxRows: source.kind === "gql" ? source.maxRows : 100,
    maxResultBytes: 512_000,
    labelRelationValues: true,
  });
  return { response, primaryTableId: "primaryTableId" in capability ? capability.primaryTableId : capability.tableId };
};
