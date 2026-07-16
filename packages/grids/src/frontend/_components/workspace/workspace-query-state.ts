import type { Table } from "../../../service";
import { gridsService } from "../../../service";
import { okState } from "./workspace-state-helpers";
import type { GridsWorkspaceState, WorkspaceCommon } from "./workspace-state-model";

export const loadQueryState = async (
  common: WorkspaceCommon,
  activeTableFromSlug: Table | null,
  activeViewSlug?: string | null,
): Promise<GridsWorkspaceState> => {
  if (!common.canUseQueryWorkspace) {
    return { kind: "accessDenied", title: "Access denied", message: "No access to this base" };
  }
  const queryTable = activeTableFromSlug ? (common.catalog.tables.find((table) => table.id === activeTableFromSlug.id) ?? null) : null;
  if (common.params.activeTableSlug && !queryTable) {
    return { kind: "accessDenied", title: "Access denied", message: "No access to this table" };
  }
  const queryViews = queryTable ? (common.catalog.viewsByTable[queryTable.id] ?? []) : [];
  const candidateQueryView = queryTable && activeViewSlug ? await gridsService.view.getByIdOrShortId(queryTable.id, activeViewSlug) : null;
  const queryView = candidateQueryView ? (queryViews.find((view) => view.id === candidateQueryView.id) ?? null) : null;
  if (activeViewSlug && !queryView) {
    return { kind: "accessDenied", title: "Access denied", message: "No access to this view" };
  }

  const currentSource = queryView
    ? ({ kind: "view", viewId: queryView.id, label: queryView.name, ref: queryView.shortId } as const)
    : queryTable
      ? ({ kind: "table", tableId: queryTable.id, label: queryTable.name, ref: queryTable.shortId } as const)
      : undefined;
  return okState(
    common,
    {
      kind: "query",
      initialQuery: common.chrome.url.searchParams.get("q") ?? "",
      initialCursor: common.chrome.url.searchParams.get("cursor"),
      queryPath: common.chrome.url.pathname,
      ...(currentSource ? { currentSource } : {}),
    },
    [
      ...common.chrome.titleBase,
      ...(queryTable
        ? [
            { title: queryTable.name, href: `/app/grids/${common.base.shortId}/table/${queryTable.shortId}` },
            ...(queryView
              ? [
                  {
                    title: queryView.name,
                    href: `/app/grids/${common.base.shortId}/table/${queryTable.shortId}/view/${queryView.shortId}`,
                  },
                ]
              : []),
          ]
        : []),
      { title: "Query" },
    ],
  );
};
