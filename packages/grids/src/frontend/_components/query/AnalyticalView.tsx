import { Placeholder } from "@valentinkolb/cloud/ui";
import { createMemo, Show } from "solid-js";
import type { Field, Table } from "../../../service";
import { openViewSettingsDialog } from "../dialogs/ViewSettingsDialogs";
import type { WorkspaceAnalyticalViewRoute } from "../workspace/workspace-state-model";
import QueryResultTable from "./QueryResultTable";

const leaveEditMode = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("edit");
  window.location.assign(`${url.pathname}${url.search}`);
};

export default function AnalyticalView(props: {
  baseShortId: string;
  route: WorkspaceAnalyticalViewRoute;
  tables: Table[];
  fieldsByTable: Record<string, Field[]>;
  editMode: boolean;
}) {
  const openSettings = () => {
    if (!props.route.canEditActiveView) return;
    openViewSettingsDialog({
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
  const result = () => props.route.initialResult;
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
        fallback={<Placeholder surface="paper" title="Loading view" description="The analytical result is being prepared." />}
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
                <Show when={props.route.canEditActiveView}>
                  <button type="button" class="btn-input btn-input-sm" onClick={openSettings}>
                    <i class="ti ti-settings" aria-hidden="true" /> View settings
                  </button>
                </Show>
              }
            />
          }
        >
          {(resolved) => (
            <QueryResultTable
              result={resolved()}
              baseShortId={props.baseShortId}
              tables={props.tables}
              fieldsByTable={props.fieldsByTable}
              scrollPreserveKey={`grids-analytical-view-${props.route.activeView.id}`}
            />
          )}
        </Show>
      </Show>
    </div>
  );
}
