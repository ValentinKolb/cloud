import { query } from "@k2b/stdlib/solid";
import { Button, DescriptionList, DetailPanel, dialogCore, PanelDialog, Placeholder, panelDialogOptions } from "@k2b/ui";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import type { PublicRecordRevision, PublicRecordRevisionPage } from "../../../api/durable-history";

export const RECORD_VERSION_PAGE_SIZE = 5;

const actionLabel: Record<PublicRecordRevision["action"], string> = {
  baseline: "History started",
  created: "Record created",
  updated: "Record updated",
  deleted: "Record moved to trash",
  restored: "Record restored",
  "file.added": "File added",
  "file.replaced": "File replaced",
  "file.removed": "File removed",
};

const valueLabel = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "Empty";
  if (Array.isArray(value)) return value.length === 0 ? "Empty" : value.map(valueLabel).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const readError = async (response: Response): Promise<string> => {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && "message" in body && typeof body.message === "string"
    ? body.message
    : "Record versions could not be loaded.";
};

const endpoint = (tableId: string, recordId: string) =>
  `/api/grids/records/${encodeURIComponent(tableId)}/${encodeURIComponent(recordId)}/versions?limit=${RECORD_VERSION_PAGE_SIZE}`;

const openRevision = (props: { tableId: string; recordId: string; revision: PublicRecordRevision }) =>
  dialogCore.open<void>((close) => {
    const fieldsById = new Map(props.revision.fields.map((field) => [field.id, field]));
    const values = Object.entries(props.revision.data)
      .map(([fieldId, value]) => ({ field: fieldsById.get(fieldId), value }))
      .filter((entry) => entry.field && entry.field.type !== "file")
      .sort((a, b) => (a.field?.position ?? 0) - (b.field?.position ?? 0));
    return (
      <PanelDialog>
        <PanelDialog.Header
          title={`Version ${props.revision.revision}`}
          subtitle={actionLabel[props.revision.action]}
          icon="ti ti-history"
          close={close}
        />
        <PanelDialog.Body>
          <PanelDialog.Section title="Version" icon="ti ti-clock-record">
            <DescriptionList
              layout="rows"
              size="sm"
              items={[
                { term: "Recorded", description: new Date(props.revision.createdAt).toLocaleString() },
                { term: "Actor", description: props.revision.actorDisplayName ?? "System or anonymous actor" },
                { term: "Record state", description: props.revision.deletedAt ? "In trash" : "Active" },
              ]}
            />
          </PanelDialog.Section>
          <PanelDialog.Section title="Fields" icon="ti ti-list-details">
            <DescriptionList
              layout="rows"
              size="sm"
              items={values.map(({ field, value }) => ({ term: field!.name, description: valueLabel(value) }))}
            />
          </PanelDialog.Section>
          <Show when={props.revision.files.length > 0}>
            <PanelDialog.Section title="Files" icon="ti ti-paperclip">
              <For each={props.revision.files}>
                {(file) => (
                  <DetailPanel.Action
                    href={`/api/grids/records/${encodeURIComponent(props.tableId)}/${encodeURIComponent(props.recordId)}/versions/${encodeURIComponent(props.revision.id)}/files/${encodeURIComponent(file.id)}`}
                    navigation="document"
                    download={file.filename}
                    title={file.filename}
                    description={`${(file.sizeBytes / 1024).toFixed(file.sizeBytes < 1024 ? 1 : 0)} KiB`}
                    leading={<i class="ti ti-file" aria-hidden="true" />}
                    trailing={<i class="ti ti-download" aria-hidden="true" />}
                  />
                )}
              </For>
            </PanelDialog.Section>
          </Show>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <span />
          <Button variant="secondary" size="sm" onClick={() => close()}>
            Close
          </Button>
        </PanelDialog.Footer>
      </PanelDialog>
    );
  }, panelDialogOptions);

export default function RecordVersions(props: { tableId: string; recordId: string }) {
  const [mounted, setMounted] = createSignal(false);
  const pages = query.createInfinite<string, PublicRecordRevisionPage, string>({
    source: () => endpoint(props.tableId, props.recordId),
    enabled: mounted,
    loadPage: async (source, { cursor, abortSignal }) => {
      const url = new URL(source, window.location.origin);
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await fetch(`${url.pathname}${url.search}`, { headers: { Accept: "application/json" }, signal: abortSignal });
      if (!response.ok) throw new Error(await readError(response));
      return response.json() as Promise<PublicRecordRevisionPage>;
    },
    getNextCursor: (page) => page.nextCursor ?? undefined,
  });
  const status = createMemo(() => pages.pages()[0]?.status ?? null);
  const enabledStatus = createMemo(() => {
    const value = status();
    return value?.enabled ? value : null;
  });
  const revisions = createMemo(() => pages.pages().flatMap((page) => page.items));
  onMount(() => setMounted(true));

  return (
    <Show when={status()?.enabled !== false}>
      <DetailPanel.Group label="Record versions">
        <DetailPanel.Section
          title="Versions"
          icon="ti ti-history"
          tone="accent"
          meta={revisions().length || undefined}
          description={enabledStatus() ? `History is provable from ${new Date(enabledStatus()!.activatedAt).toLocaleString()}.` : undefined}
        >
          <div class="flex flex-col gap-2">
            <Show when={pages.loading() && revisions().length === 0}>
              <Placeholder align="left" class="px-0 py-2" description={<>Loading record versions…</>} />
            </Show>
            <Show when={pages.error()}>
              {(error) => (
                <div class="flex items-center gap-2 text-sm text-danger" role="alert">
                  <span>{error().message}</span>
                  <Button size="xs" variant="ghost" onClick={() => void pages.invalidate()}>
                    Retry
                  </Button>
                </div>
              )}
            </Show>
            <For each={revisions()}>
              {(revision) => {
                const names = new Map(revision.fields.map((field) => [field.id, field.name]));
                const changed = revision.changedFieldIds.flatMap((fieldId) => (names.get(fieldId) ? [names.get(fieldId)!] : [])).join(", ");
                return (
                  <DetailPanel.Action
                    onClick={() => void openRevision({ tableId: props.tableId, recordId: props.recordId, revision })}
                    title={`Version ${revision.revision} · ${actionLabel[revision.action]}`}
                    description={`${changed ? `${changed} · ` : ""}${revision.actorDisplayName ?? "System or anonymous actor"} · ${new Date(revision.createdAt).toLocaleString()}`}
                    leading={<i class="ti ti-history" aria-hidden="true" />}
                    trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
                  />
                );
              }}
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
      </DetailPanel.Group>
    </Show>
  );
}
