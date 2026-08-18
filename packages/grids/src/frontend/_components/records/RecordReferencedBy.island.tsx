import { query } from "@k2b/stdlib/solid";
import { Button, DetailPanel, Placeholder } from "@k2b/ui";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";

export type ReferencedByItem = {
  sourceTableId: string;
  sourceTableName: string;
  sourceRecordId: string;
  sourceRecordLabel: string;
  relationFieldId: string;
  relationFieldName: string;
};

type ReferencedByPage = { items: ReferencedByItem[]; nextCursor: string | null };
export type ReferencedByGroup = { tableName: string; fieldName: string; items: ReferencedByItem[] };
export const REFERENCED_BY_PAGE_SIZE = 5;

export const referencedByEndpoint = (tableId: string, recordId: string) =>
  `/api/grids/records/${encodeURIComponent(tableId)}/${encodeURIComponent(recordId)}/referenced-by?limit=${REFERENCED_BY_PAGE_SIZE}`;

export const groupReferencedByItems = (items: readonly ReferencedByItem[]): ReferencedByGroup[] => {
  const deduped = new Map<string, ReferencedByItem>();
  for (const item of items) deduped.set(`${item.sourceRecordId}:${item.relationFieldId}`, item);
  const grouped = new Map<string, ReferencedByGroup>();
  for (const item of deduped.values()) {
    const key = `${item.sourceTableId}:${item.relationFieldId}`;
    const group = grouped.get(key) ?? { tableName: item.sourceTableName, fieldName: item.relationFieldName, items: [] };
    group.items.push(item);
    grouped.set(key, group);
  }
  return [...grouped.values()];
};

export const referencedByActionTitle = (item: ReferencedByItem): string => `${item.relationFieldName} · ${item.sourceRecordLabel}`;

const readError = async (response: Response): Promise<string> => {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && "message" in body && typeof body.message === "string"
    ? body.message
    : "Referenced records could not be loaded.";
};

export default function RecordReferencedBy(props: { baseId: string; tableId: string; recordId: string }) {
  const [mounted, setMounted] = createSignal(false);
  const endpoint = () => referencedByEndpoint(props.tableId, props.recordId);
  const pages = query.createInfinite<string, ReferencedByPage, string>({
    source: endpoint,
    enabled: mounted,
    loadPage: async (source, { cursor, abortSignal }) => {
      const url = new URL(source, window.location.origin);
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await fetch(`${url.pathname}${url.search}`, {
        headers: { Accept: "application/json" },
        signal: abortSignal,
      });
      if (!response.ok) throw new Error(await readError(response));
      return response.json() as Promise<ReferencedByPage>;
    },
    getNextCursor: (page) => page.nextCursor ?? undefined,
  });
  const groups = createMemo(() => groupReferencedByItems(pages.pages().flatMap((page) => page.items)));
  onMount(() => setMounted(true));

  return (
    <DetailPanel.Section title="Referenced by" icon="ti ti-link-plus" tone="accent">
      <div class="flex flex-col gap-3">
        <Show when={pages.loading() && pages.pages().length === 0}>
          <Placeholder align="left" class="px-0 py-2" description={<>Loading referenced records…</>} />
        </Show>
        <Show when={pages.error()}>
          {(error) => (
            <div class="flex items-center gap-2 text-sm text-red-600 dark:text-red-400" role="alert">
              <span>{error().message}</span>
              <Button size="xs" variant="ghost" onClick={() => void pages.invalidate()}>
                Retry
              </Button>
            </div>
          )}
        </Show>
        <Show when={!pages.loading() && !pages.error() && groups().length === 0}>
          <Placeholder align="left" class="px-0 py-2" description={<>No live records reference this record.</>} />
        </Show>
        <For each={groups()}>
          {(group) => (
            <For each={group.items}>
              {(item) => (
                <DetailPanel.Action
                  href={`/app/grids/${encodeURIComponent(props.baseId)}/table/${encodeURIComponent(item.sourceTableId)}?record=${encodeURIComponent(item.sourceRecordId)}`}
                  title={referencedByActionTitle(item)}
                  description={item.sourceTableName}
                  leading={<i class="ti ti-table-row" aria-hidden="true" />}
                  trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
                />
              )}
            </For>
          )}
        </For>
        <Show when={pages.hasMore()}>
          <Button
            variant="ghost"
            size="sm"
            class="w-fit"
            loading={pages.loadingMore()}
            loadingLabel="Loading more"
            onClick={() => void pages.loadMore()}
          >
            Load more
          </Button>
        </Show>
      </div>
    </DetailPanel.Section>
  );
}
