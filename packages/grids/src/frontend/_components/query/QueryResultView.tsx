import { Placeholder, prompts } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DslQueryPreviewResponse } from "../../../contracts";
import type { Field, Table } from "../../../service";
import { openViewSettingsDialog } from "../dialogs/ViewSettingsDialogs";
import { errorMessage } from "../utils/api-helpers";
import type { WorkspaceQueryResultViewRoute } from "../workspace/workspace-state-model";
import QueryResultTable from "./QueryResultTable";

const leaveEditMode = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("edit");
  window.location.assign(`${url.pathname}${url.search}`);
};

const syncCursorToUrl = (cursor: string | null) => {
  const url = new URL(window.location.href);
  if (cursor) url.searchParams.set("cursor", cursor);
  else url.searchParams.delete("cursor");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
};

export default function QueryResultView(props: {
  baseId: string;
  baseShortId: string;
  route: WorkspaceQueryResultViewRoute;
  tables: Table[];
  fieldsByTable: Record<string, Field[]>;
  editMode: boolean;
}) {
  type PageRequest = { cursor: string | null; history: Array<string | null> };
  const openSettings = () => {
    if (!props.route.canEditActiveView) return;
    openViewSettingsDialog({
      baseId: props.baseId,
      baseShortId: props.baseShortId,
      tableShortId: props.route.activeTable.shortId,
      viewShortId: props.route.activeView.shortId,
      tableName: props.route.activeTable.name,
      initialView: props.route.activeView,
      fields: props.route.fields,
      initialAccessEntries: props.route.activeViewAccessEntries,
      canEditAccess: props.route.canManageActiveTable,
      onSaved: () => window.location.reload(),
    });
  };
  const [result, setResult] = createSignal<DslQueryPreviewResponse | null>(props.route.initialResult);
  const [pageCursor, setPageCursor] = createSignal<string | null>(props.route.initialCursor);
  const [pageHistory, setPageHistory] = createSignal<Array<string | null>>([]);
  const [hydrated, setHydrated] = createSignal(false);
  const tableShortIds = createMemo(() => Object.fromEntries(props.tables.map((table) => [table.id, table.shortId])));
  onMount(() => setHydrated(true));
  const pageMut = mutations.create<DslQueryPreviewResponse, PageRequest, PageRequest>({
    onBefore: (request) => request,
    mutation: async (request, { abortSignal }) => {
      const response = await apiClient.gql["by-base"][":baseId"].views[":viewId"].execute.$post(
        {
          param: { baseId: props.baseId, viewId: props.route.activeView.id },
          json: { pageSize: 100, ...(request.cursor ? { cursor: request.cursor } : {}), surface: "records-view" },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not load view page."));
      return response.json();
    },
    onSuccess: (next, request) => {
      setResult(next);
      if (!request) return;
      setPageCursor(request.cursor);
      setPageHistory(request.history);
      syncCursorToUrl(request.cursor);
    },
    onError: (error) => prompts.error(error.message),
  });
  const success = createMemo(() => {
    const current = result();
    return current?.ok ? current : null;
  });
  const diagnostics = createMemo(() => {
    const current = result();
    return current && !current.ok ? current.diagnostics : [];
  });

  return (
    <div class="flex h-full min-h-0 flex-1 flex-col gap-2">
      <Show when={props.editMode && props.route.canEditActiveView}>
        <div class="flex shrink-0 items-center gap-2">
          <button type="button" class="btn-input-success btn-input-sm" onClick={openSettings}>
            <i class="ti ti-table-spark" aria-hidden="true" /> View
          </button>
          <button type="button" class="btn-simple btn-sm ml-auto" onClick={leaveEditMode}>
            Done
          </button>
        </div>
      </Show>
      <Show
        when={result()}
        fallback={<Placeholder surface="paper" title="Loading view" description="The query result is being prepared." />}
      >
        <Show
          when={success()}
          fallback={
            <Placeholder
              state="error"
              surface="paper"
              title="Could not load view"
              description={
                diagnostics()
                  .map((item) => item.message)
                  .join("; ") || "The view returned no result."
              }
              action={
                <div class="flex flex-wrap items-center justify-center gap-2">
                  <Show when={pageCursor()}>
                    <button
                      type="button"
                      class="btn-input btn-input-sm"
                      disabled={pageMut.loading()}
                      onClick={() => pageMut.mutate({ cursor: null, history: [] })}
                    >
                      <i class="ti ti-chevrons-left" aria-hidden="true" /> First page
                    </button>
                  </Show>
                  <Show when={props.route.canEditActiveView}>
                    <button type="button" class="btn-input btn-input-sm" onClick={openSettings}>
                      <i class="ti ti-settings" aria-hidden="true" /> View settings
                    </button>
                  </Show>
                </div>
              }
            />
          }
        >
          {(resolved) => (
            <QueryResultTable
              result={resolved()}
              baseShortId={props.baseShortId}
              tableShortIds={tableShortIds()}
              fieldsByTable={props.fieldsByTable}
              scrollPreserveKey={`grids-query-result-view-${props.route.activeView.id}`}
              loading={!hydrated() || pageMut.loading()}
              canGoBack={pageHistory().length > 0 || pageCursor() !== null}
              backLabel={pageHistory().length > 0 ? "Previous" : "First page"}
              onPrevious={() => {
                const history = pageHistory();
                if (history.length === 0 && !pageCursor()) return;
                pageMut.mutate({
                  cursor: history.length > 0 ? (history.at(-1) ?? null) : null,
                  history: history.length > 0 ? history.slice(0, -1) : [],
                });
              }}
              onNext={(cursor) => pageMut.mutate({ cursor, history: [...pageHistory(), pageCursor()] })}
            />
          )}
        </Show>
      </Show>
    </div>
  );
}
