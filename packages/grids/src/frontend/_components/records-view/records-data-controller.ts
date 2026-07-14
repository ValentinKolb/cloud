import { type Accessor, createEffect, createSignal, onCleanup, onMount, type Setter } from "solid-js";
import type { TableQueryResult } from "../../../contracts";
import type { GridRecord } from "../../../service";
import { fetchTableQuery } from "./fetcher";
import { createGridsRecordEventsProvider } from "./grids-record-events-provider";
import {
  highlightedIdsForLiveRefresh,
  liveRefreshQuery,
  shouldLoadNextLiveRefreshPage,
  shouldOptimisticallyRemoveDeletedRecord,
  visibleIdsFromResult,
} from "./live-refresh";
import { createRecordsQueryController, type RecordsQuerySource, type RecordsTableQueryResult } from "./records-query-controller";

type FilePreviews = NonNullable<TableQueryResult["filePreviews"]>;

type FlatRecordsPage = {
  items: GridRecord[];
  nextCursor: string | null;
  filePreviews: FilePreviews;
};

export const reconcileFlatRecordsPage = (current: FlatRecordsPage, response: TableQueryResult, append: boolean): FlatRecordsPage => {
  const pageItems = (response.items ?? []) as GridRecord[];
  if (!append) {
    return {
      items: pageItems,
      nextCursor: response.nextCursor ?? null,
      filePreviews: response.filePreviews ?? {},
    };
  }

  const seen = new Set(current.items.map((record) => record.id));
  return {
    items: [...current.items, ...pageItems.filter((record) => !seen.has(record.id))],
    nextCursor: response.nextCursor ?? null,
    filePreviews: { ...current.filePreviews, ...(response.filePreviews ?? {}) },
  };
};

type FetchRecords = typeof fetchTableQuery;

export const fetchVisibleFlatRecords = async (options: {
  source: RecordsQuerySource;
  targetCount: number;
  signal: AbortSignal;
  fetchRecords?: FetchRecords;
}): Promise<TableQueryResult> => {
  const desiredCount = Math.max(options.targetCount, 1);
  const fetchRecords = options.fetchRecords ?? fetchTableQuery;
  let nextCursor: string | null = null;
  let firstPage: TableQueryResult | null = null;
  const combinedItems: GridRecord[] = [];
  const combinedFilePreviews: FilePreviews = {};

  do {
    const page = await fetchRecords(
      {
        tableId: options.source.tableId,
        viewId: options.source.viewId,
        query: liveRefreshQuery(options.source.query, Math.max(desiredCount - combinedItems.length, 1)),
        cursor: nextCursor,
        filePreviewFieldIds: options.source.filePreviewFieldIds,
      },
      { signal: options.signal },
    );
    firstPage ??= page;
    combinedItems.push(...((page.items ?? []) as GridRecord[]));
    Object.assign(combinedFilePreviews, page.filePreviews ?? {});
    nextCursor = page.nextCursor ?? null;
  } while (
    shouldLoadNextLiveRefreshPage({
      loadedCount: combinedItems.length,
      targetCount: desiredCount,
      nextCursor,
    })
  );

  return {
    ...(firstPage ?? { nextCursor: null }),
    items: combinedItems,
    filePreviews: Object.keys(combinedFilePreviews).length > 0 ? combinedFilePreviews : undefined,
    nextCursor,
  };
};

type LiveProviderError = { message: string };

type RecordsDataControllerOptions = {
  tableId: string;
  trashMode: boolean;
  source: Accessor<RecordsQuerySource>;
  initialData: TableQueryResult;
  cursor: Accessor<string | null>;
  setCursor: Setter<string | null>;
  isGrouped: Accessor<boolean>;
  hasBlockingDialog: Accessor<boolean>;
  onOptimisticDelete: (recordId: string) => void;
  onRefreshed: (result: TableQueryResult) => Promise<void> | void;
  onRevoked: (error: LiveProviderError) => void;
  onFatal: (error: LiveProviderError) => void;
};

export const createRecordsDataController = (options: RecordsDataControllerOptions) => {
  const recordsQuery = createRecordsQueryController({
    source: options.source,
    initialValue: options.initialData,
  });
  const [flatPage, setFlatPage] = createSignal<FlatRecordsPage>({
    items: (options.initialData.items ?? []) as GridRecord[],
    nextCursor: options.initialData.nextCursor ?? null,
    filePreviews: options.initialData.filePreviews ?? {},
  });
  const [livePending, setLivePending] = createSignal(false);
  const [liveRefreshing, setLiveRefreshing] = createSignal(false);
  const [highlightedRecordIds, setHighlightedRecordIds] = createSignal<Set<string>>(new Set());
  let didApplyFirstFlatPage = false;
  let liveRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let liveRefreshAbort: AbortController | undefined;
  let liveProvider: ReturnType<typeof createGridsRecordEventsProvider> | null = null;
  let pendingLiveCursor: string | null = null;
  let refreshRequestId = 0;
  let pendingLiveRecordIds = new Set<string>();
  let staleResourceEpochFloor = -1;
  let liveCommitId = 0;

  const invalidate = () => {
    refreshRequestId++;
    liveRefreshAbort?.abort();
    liveRefreshAbort = undefined;
    pendingLiveRecordIds = new Set();
    pendingLiveCursor = null;
    if (liveRefreshTimer) {
      clearTimeout(liveRefreshTimer);
      liveRefreshTimer = undefined;
    }
    setLivePending(false);
    setLiveRefreshing(false);
  };

  createEffect(() => {
    const response = recordsQuery.latest();
    if (!response || options.isGrouped()) return;
    const isLiveCommit = typeof response.__liveCommitId === "number" && response.__liveCommitId === liveCommitId;
    const fetchEpoch = response.__recordsFetchEpoch ?? 0;
    if (isLiveCommit || fetchEpoch <= staleResourceEpochFloor) return;

    const append = didApplyFirstFlatPage && !!options.cursor();
    didApplyFirstFlatPage = true;
    setFlatPage((current) => reconcileFlatRecordsPage(current, response, append));
  });

  const items = () => (options.isGrouped() ? (recordsQuery.latest()?.items ?? []) : flatPage().items);
  const buckets = () => recordsQuery.latest()?.buckets ?? [];
  const aggregates = () => recordsQuery.latest()?.aggregates ?? {};
  const relationLabels = () => recordsQuery.latest()?.relationLabels ?? {};

  const replaceRecord = (record: GridRecord) => {
    if (options.isGrouped()) return;
    setFlatPage((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === record.id ? record : item)),
    }));
  };

  const removeRecord = (recordId: string) => {
    if (!options.isGrouped()) {
      setFlatPage((current) => ({
        ...current,
        items: current.items.filter((record) => record.id !== recordId),
      }));
    }
    setHighlightedRecordIds((current) => {
      if (!current.has(recordId)) return current;
      const next = new Set(current);
      next.delete(recordId);
      return next;
    });
  };

  const loadNextPage = () => {
    const next = flatPage().nextCursor;
    if (!next || recordsQuery.data.loading || options.isGrouped()) return;
    invalidate();
    options.setCursor(next);
  };

  function scheduleLiveRefresh() {
    if (options.trashMode) return;
    setLivePending(true);
    if (options.hasBlockingDialog()) return;
    if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
    liveRefreshTimer = setTimeout(() => {
      liveRefreshTimer = undefined;
      if (options.hasBlockingDialog()) {
        setLivePending(true);
        return;
      }
      void refreshVisibleRecords();
    }, 250);
  }

  async function refreshVisibleRecords(config: { recordIds?: Iterable<string>; force?: boolean } = {}) {
    if (!config.force && (recordsQuery.data.loading || options.hasBlockingDialog())) {
      if (config.recordIds) {
        for (const id of config.recordIds) pendingLiveRecordIds.add(id);
      }
      setLivePending(true);
      return;
    }

    const eventRecordIds = new Set(config.recordIds ?? pendingLiveRecordIds);
    pendingLiveRecordIds = new Set();
    const cursorToApply = pendingLiveCursor;
    const previousVisibleIds = options.isGrouped() ? [] : flatPage().items.map((record) => record.id);
    const requestId = ++refreshRequestId;
    liveRefreshAbort?.abort();
    const abort = new AbortController();
    liveRefreshAbort = abort;
    setLivePending(false);
    setLiveRefreshing(true);

    try {
      const source = options.source();
      const next = options.isGrouped()
        ? await fetchTableQuery({ ...source, cursor: null }, { signal: abort.signal })
        : await fetchVisibleFlatRecords({
            source,
            targetCount: flatPage().items.length,
            signal: abort.signal,
          });
      if (requestId !== refreshRequestId) return;

      if (!options.isGrouped()) {
        setFlatPage((current) => reconcileFlatRecordsPage(current, next, false));
      }
      liveCommitId++;
      staleResourceEpochFloor = recordsQuery.fetchEpoch();
      recordsQuery.mutate({ ...next, __liveCommitId: liveCommitId } as RecordsTableQueryResult);
      await options.onRefreshed(next);
      liveProvider?.markApplied(cursorToApply);
      if (pendingLiveCursor === cursorToApply) pendingLiveCursor = null;

      if (!options.isGrouped()) {
        const highlighted = highlightedIdsForLiveRefresh({
          eventRecordIds,
          previousVisibleIds,
          nextVisibleIds: visibleIdsFromResult(next),
        });
        if (highlighted.length > 0) {
          if (highlightTimer) clearTimeout(highlightTimer);
          setHighlightedRecordIds(new Set(highlighted));
          highlightTimer = setTimeout(() => setHighlightedRecordIds(new Set()), 1400);
        }
      }
      if (pendingLiveCursor) {
        setLivePending(true);
        scheduleLiveRefresh();
      }
    } catch {
      if (abort.signal.aborted) return;
      if (requestId === refreshRequestId) {
        pendingLiveRecordIds = new Set([...eventRecordIds, ...pendingLiveRecordIds]);
        setLivePending(true);
      }
    } finally {
      if (liveRefreshAbort === abort) liveRefreshAbort = undefined;
      if (requestId === refreshRequestId) setLiveRefreshing(false);
    }
  }

  createEffect(() => {
    if (options.trashMode || !livePending()) return;
    if (liveRefreshing() || recordsQuery.data.loading || options.hasBlockingDialog() || liveRefreshTimer) return;
    void refreshVisibleRecords();
  });

  onMount(() => {
    if (options.trashMode || typeof document === "undefined") return;

    const drainAfterDialogClose = () => {
      requestAnimationFrame(() => {
        if (!livePending() || liveRefreshing() || recordsQuery.data.loading || options.hasBlockingDialog()) return;
        void refreshVisibleRecords();
      });
    };

    document.addEventListener("close", drainAfterDialogClose, true);
    onCleanup(() => document.removeEventListener("close", drainAfterDialogClose, true));
  });

  onMount(() => {
    if (options.trashMode) return;
    liveProvider = createGridsRecordEventsProvider({
      tableId: options.tableId,
      onReady: () => void refreshVisibleRecords(),
      onEvent: (event, cursor) => {
        if (!event) return;
        if (cursor) pendingLiveCursor = cursor;
        pendingLiveRecordIds.add(event.recordId);
        if (event.type === "record.deleted" && shouldOptimisticallyRemoveDeletedRecord(options.source().query)) {
          removeRecord(event.recordId);
          options.onOptimisticDelete(event.recordId);
        }
        scheduleLiveRefresh();
      },
      onError: () => setLivePending(true),
      onRevoked: (error) => {
        setLivePending(false);
        liveCommitId++;
        staleResourceEpochFloor = recordsQuery.fetchEpoch();
        setFlatPage({ items: [], nextCursor: null, filePreviews: {} });
        recordsQuery.mutate({
          items: [],
          buckets: [],
          aggregates: {},
          nextCursor: null,
          __liveCommitId: liveCommitId,
        } as RecordsTableQueryResult);
        options.onRevoked(error);
      },
      onFatal: (error) => {
        setLivePending(false);
        options.onFatal(error);
      },
    });

    liveProvider.connect();
    onCleanup(() => {
      liveProvider?.dispose();
      liveProvider = null;
      liveRefreshAbort?.abort();
      if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
      if (highlightTimer) clearTimeout(highlightTimer);
    });
  });

  return {
    data: recordsQuery.data,
    failure: recordsQuery.failure,
    refetch: recordsQuery.refetch,
    items,
    buckets,
    aggregates,
    relationLabels,
    filePreviews: () => flatPage().filePreviews,
    nextCursor: () => flatPage().nextCursor,
    livePending,
    liveRefreshing,
    highlightedRecordIds,
    invalidate,
    loadNextPage,
    refreshVisibleRecords,
    replaceRecord,
    removeRecord,
  };
};
