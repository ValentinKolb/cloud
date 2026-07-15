import { Pagination, Placeholder } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { createSignal, onCleanup, onMount } from "solid-js";
import type { ItemListResult, SpaceColumn, SpaceTag } from "@/contracts";
import { subscribeToDetailSelection } from "../../../lib/detail";
import FilterBar from "../filter/FilterBar";
import { buildFilterUrl, defaultFilter, type FilterState, hasActiveFilters } from "../filter/types";
import ItemsList from "../list";
import CreateItemButton from "../sidebar/CreateItemButton";
import ItemsTable from "../table/ItemsTable";
import { useSpacesViewRefresh } from "./view-refresh";
import { requestSpacesRouteNavigation } from "./workspace-events";

type Props = {
  spaceId: string;
  currentView: "list" | "table";
  columns: SpaceColumn[];
  tags: SpaceTag[];
  filter: FilterState;
  initialItemsResult: ItemListResult;
  initialSelectedItemId: string;
  itemLinkBaseUrl: string;
  paginationBaseUrl: string;
  dateConfig?: DateContext;
  canWrite: boolean;
};

export default function SpacesListRoute(props: Props) {
  const [itemsResult, setItemsResult] = createSignal(props.initialItemsResult);
  const [selectedItemId, setSelectedItemId] = createSignal(props.initialSelectedItemId);
  useSpacesViewRefresh((snapshot) => {
    if (snapshot.kind === "list" && snapshot.currentView === props.currentView) setItemsResult(snapshot.itemsResult);
    else window.location.reload();
  });

  onMount(() => {
    const unsubscribe = subscribeToDetailSelection(({ itemId }) => setSelectedItemId(itemId ?? ""));
    onCleanup(unsubscribe);
  });

  const commitFilterPatch = (patch: Partial<FilterState>) => {
    requestSpacesRouteNavigation(buildFilterUrl(props.itemLinkBaseUrl, { ...patch, page: 1 }, props.filter), { replace: true });
  };

  const clearFilters = () =>
    requestSpacesRouteNavigation(buildFilterUrl(props.itemLinkBaseUrl, defaultFilter, defaultFilter), { replace: true });

  return (
    <>
      <FilterBar
        spaceId={props.spaceId}
        columns={props.columns}
        tags={props.tags}
        filter={props.filter}
        total={itemsResult().total}
        baseUrl={props.itemLinkBaseUrl}
        hideGroupBy={props.currentView === "table"}
        onFilterChange={commitFilterPatch}
        onSearchChange={(search) => commitFilterPatch({ search })}
        onClearFilters={clearFilters}
      />
      <div class="h-2" />

      <div class="min-h-0 flex-1 overflow-y-auto" data-scroll-preserve={`spaces-main-${props.spaceId}`}>
        {itemsResult().items.length === 0 ? (
          !hasActiveFilters(props.filter) ? (
            <Placeholder
              icon="ti ti-checkbox"
              variant="panel"
              title="No items yet"
              description={
                props.canWrite ? "Create a task to start organizing work in this space." : "This space does not contain any items yet."
              }
              action={
                props.canWrite ? (
                  <CreateItemButton
                    spaceId={props.spaceId}
                    columns={props.columns}
                    tags={props.tags}
                    dateConfig={props.dateConfig}
                    variant="chip"
                    defaultType="task"
                  />
                ) : undefined
              }
            />
          ) : (
            <Placeholder
              icon="ti ti-filter-off"
              variant="panel"
              title="No matching items"
              description="Try a different search or clear the active filters."
              action={
                <button type="button" class="btn-secondary btn-sm" onClick={clearFilters}>
                  <i class="ti ti-filter-off" /> Clear filters
                </button>
              }
            />
          )
        ) : props.currentView === "table" ? (
          <ItemsTable
            items={itemsResult().items}
            spaceId={props.spaceId}
            columns={props.columns}
            tags={props.tags}
            selectedItemId={selectedItemId()}
            baseUrl={props.itemLinkBaseUrl}
            scrollPreserveKey={`spaces-table-${props.spaceId}`}
            dateConfig={props.dateConfig}
          />
        ) : (
          <ItemsList
            items={itemsResult().items}
            columns={props.columns}
            tags={props.tags}
            spaceId={props.spaceId}
            selectedItemId={selectedItemId()}
            groupBy={props.filter.groupBy}
            showCompleted={props.filter.status !== "active"}
            baseUrl={props.itemLinkBaseUrl}
            dateConfig={props.dateConfig}
            canWrite={props.canWrite}
          />
        )}

        {itemsResult().totalPages > 1 && (
          <div class="py-2">
            <Pagination currentPage={itemsResult().page} totalPages={itemsResult().totalPages} baseUrl={props.paginationBaseUrl} />
          </div>
        )}
      </div>
    </>
  );
}
