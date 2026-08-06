import {
  NoticeCard,
  dialogCore,
  formatFileViewSize,
  PanelDialog,
  Placeholder,
  panelDialogWorkspaceOptions,
  Select,
  Tooltip,
  Button,
  ButtonLink,
  IconButtonLink,
} from "@k2b/ui";
import { mutation } from "@k2b/stdlib/solid";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import { type MessageInspector, type MessageSourcePreview, messageInspectorSchema, messageSourcePreviewSchema } from "../../contracts";
import type { MessageDetail } from "../../service/messages";
import { readApiError } from "./api-response";

type InspectorTab = "overview" | "headers" | "source";

const inspectorTabs = [
  { value: "overview", label: "Overview", icon: "ti ti-info-circle" },
  { value: "headers", label: "Headers", icon: "ti ti-list-details" },
  { value: "source", label: "Source", icon: "ti ti-code" },
] as const;

const messageOptionLabel = (message: MessageDetail, index: number): string => `${index + 1}. ${message.subject.trim() || "(no subject)"}`;

const sourceHref = (mailboxId: string, messageId: string): string => `/api/mail/mailboxes/${mailboxId}/messages/${messageId}/source`;

const subscriptionsHref = (mailboxId: string, listKey: string): string =>
  `/app/mail/${mailboxId}/subscriptions?list=${encodeURIComponent(listKey)}`;

function MailMessageInspectorDialog(props: {
  mailboxId: string;
  messages: MessageDetail[];
  initialMessageId: string;
  initialTab: InspectorTab;
  close: () => void;
}) {
  const [selectedMessageId, setSelectedMessageId] = createSignal(props.initialMessageId);
  const [tab, setTab] = createSignal<InspectorTab>(props.initialTab);
  const [inspector, setInspector] = createSignal<MessageInspector | null>(null);
  const [sourcePreview, setSourcePreview] = createSignal<MessageSourcePreview | null>(null);

  const loadInspector = mutation.create<MessageInspector, string>({
    mutation: async (messageId, context) => {
      const response = await apiClient.mailboxes[":mailboxId"].messages[":messageId"].inspector.$get(
        { param: { mailboxId: props.mailboxId, messageId } },
        { init: { signal: context.abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not inspect this message"));
      return messageInspectorSchema.parse(await response.json());
    },
    onSuccess: setInspector,
  });

  const loadSourcePreview = mutation.create<MessageSourcePreview, string>({
    mutation: async (messageId, context) => {
      const response = await apiClient.mailboxes[":mailboxId"].messages[":messageId"]["source-preview"].$get(
        { param: { mailboxId: props.mailboxId, messageId } },
        { init: { signal: context.abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load the message source"));
      return messageSourcePreviewSchema.parse(await response.json());
    },
    onSuccess: setSourcePreview,
  });

  const reloadInspector = (messageId: string) => {
    loadInspector.abort();
    loadSourcePreview.abort();
    setInspector(null);
    setSourcePreview(null);
    void loadInspector.mutate(messageId);
  };

  createEffect(() => reloadInspector(selectedMessageId()));
  createEffect(() => {
    if (tab() !== "source" || sourcePreview() || loadSourcePreview.loading()) return;
    const current = inspector();
    if (current?.source.available) void loadSourcePreview.mutate(current.id);
  });
  onCleanup(() => {
    loadInspector.abort();
    loadSourcePreview.abort();
  });

  const selectedMessage = () => props.messages.find((message) => message.id === selectedMessageId()) ?? props.messages.at(-1);
  const downloadName = () => `${selectedMessage()?.subject.trim() || "message"}.eml`;

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Message inspector"
        subtitle="Delivery metadata, headers, and the exact stored message"
        icon="ti ti-file-search"
        actions={
          <Show when={inspector()?.source.available}>
            <Tooltip.Anchor content="Download original message">
              <IconButtonLink
                href={sourceHref(props.mailboxId, selectedMessageId())}
                download={downloadName()}
                label="Download original message"
              >
                <i class="ti ti-download" aria-hidden="true" />
                <span class="sr-only">Download original message</span>
              </IconButtonLink>
            </Tooltip.Anchor>
          </Show>
        }
        close={props.close}
      />
      <PanelDialog.Body scrollPreserveKey={`mail-message-inspector:${selectedMessageId()}:${tab()}`}>
        <div class="flex min-h-full flex-col gap-2">
          <Show when={props.messages.length > 1}>
            <Select
              label="Message"
              icon="ti ti-mail"
              value={selectedMessageId}
              options={props.messages.map((message, index) => ({
                id: message.id,
                label: messageOptionLabel(message, index),
                description: message.from.map((address) => address.name || address.address).join(", ") || "Unknown sender",
              }))}
              onValueChange={setSelectedMessageId}
            />
          </Show>
          <PanelDialog.Tabs options={inspectorTabs} value={tab} onValueChange={setTab} ariaLabel="Message inspection view" />

          <Show
            when={inspector()}
            fallback={
              <Show when={loadInspector.error()} fallback={<Placeholder state="loading" variant="panel" title="Loading message details" />}>
                {(error) => (
                  <Placeholder
                    state="error"
                    variant="panel"
                    title="Could not inspect this message"
                    description={error().message}
                    action={
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        disabled={loadInspector.loading()}
                        onClick={() => reloadInspector(selectedMessageId())}
                      >
                        <i class="ti ti-refresh" aria-hidden="true" /> Retry
                      </Button>
                    }
                  />
                )}
              </Show>
            }
          >
            {(current) => (
              <>
                <Show when={current().warnings.length > 0}>
                  <NoticeCard tone="warning" icon={false} bodyClass="flex flex-col gap-1" role="status">
                    <For each={current().warnings}>{(warning) => <p>{warning}</p>}</For>
                  </NoticeCard>
                </Show>

                <Show when={tab() === "overview"}>
                  <div class="grid gap-2 lg:grid-cols-2">
                    <section class="detail-section">
                      <p class="detail-section-label">Message</p>
                      <dl class="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                        <dt class="text-dimmed">Message ID</dt>
                        <dd class="break-all font-mono text-secondary">{current().messageId ?? "Unavailable"}</dd>
                        <dt class="text-dimmed">In reply to</dt>
                        <dd class="break-all font-mono text-secondary">{current().inReplyTo ?? "None"}</dd>
                        <dt class="text-dimmed">Received</dt>
                        <dd class="text-primary">{new Date(current().internalDate).toLocaleString()}</dd>
                        <dt class="text-dimmed">Sent</dt>
                        <dd class="text-primary">{current().sentAt ? new Date(current().sentAt ?? "").toLocaleString() : "Unavailable"}</dd>
                        <dt class="text-dimmed">Size</dt>
                        <dd class="text-primary">{formatFileViewSize(current().sizeBytes)}</dd>
                        <dt class="text-dimmed">Content type</dt>
                        <dd class="break-all text-primary">{current().contentType ?? "Unavailable"}</dd>
                        <dt class="text-dimmed">Hydration</dt>
                        <dd class="text-primary">{current().hydrationStatus}</dd>
                      </dl>
                    </section>

                    <section class="detail-section">
                      <p class="detail-section-label">Stored source</p>
                      <dl class="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                        <dt class="text-dimmed">Available</dt>
                        <dd class="text-primary">{current().source.available ? "Exact original" : "No"}</dd>
                        <dt class="text-dimmed">Size</dt>
                        <dd class="text-primary">
                          {current().source.byteLength === null ? "Unavailable" : formatFileViewSize(current().source.byteLength!)}
                        </dd>
                        <dt class="text-dimmed">MIME parts</dt>
                        <dd class="text-primary">{current().parts.length}</dd>
                        <dt class="text-dimmed">Attachments</dt>
                        <dd class="text-primary">{current().attachments.length}</dd>
                        <dt class="text-dimmed">Placements</dt>
                        <dd class="text-primary">{current().placements.length}</dd>
                      </dl>
                      <Show when={current().source.available}>
                        <ButtonLink
                          variant="secondary"
                          size="sm"
                          class="mt-3 inline-flex"
                          href={sourceHref(props.mailboxId, current().id)}
                          download={downloadName()}
                        >
                          <i class="ti ti-download" aria-hidden="true" /> Download .eml
                        </ButtonLink>
                      </Show>
                    </section>
                  </div>

                  <Show when={current().mailingList}>
                    {(list) => (
                      <section class="detail-section">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                          <div class="min-w-0">
                            <p class="detail-section-label">Mailing list</p>
                            <p class="truncate text-sm font-medium text-primary">{list().name}</p>
                            <Show when={list().name.toLowerCase() !== list().address.toLowerCase()}>
                              <p class="truncate text-xs text-dimmed">{list().address}</p>
                            </Show>
                          </div>
                          <ButtonLink variant="secondary" size="sm" href={subscriptionsHref(props.mailboxId, list().listKey)}>
                            <i class="ti ti-settings" aria-hidden="true" />
                            Manage subscription
                          </ButtonLink>
                        </div>
                        <div class="mt-3 flex flex-wrap items-center gap-2">
                          <Show when={list().postHref}>
                            <ButtonLink variant="ghost" size="sm" href={list().postHref!}>
                              <i class="ti ti-send" aria-hidden="true" />
                              Write to list
                            </ButtonLink>
                          </Show>
                          <Show when={list().helpHref}>
                            <ButtonLink variant="ghost" size="sm" href={list().helpHref!} target="_blank" rel="noopener noreferrer">
                              <i class="ti ti-help" aria-hidden="true" />
                              List help
                            </ButtonLink>
                          </Show>
                          <Show when={list().archiveHref}>
                            <ButtonLink variant="ghost" size="sm" href={list().archiveHref!} target="_blank" rel="noopener noreferrer">
                              <i class="ti ti-world" aria-hidden="true" />
                              List archive
                            </ButtonLink>
                          </Show>
                        </div>
                      </section>
                    )}
                  </Show>

                  <Show when={current().spam.flag || current().spam.status || current().spam.score}>
                    <section class="detail-section">
                      <p class="detail-section-label">Spam diagnostics</p>
                      <p class="mb-3 text-xs text-dimmed">
                        These values come from headers added by the mail provider. Cloud does not calculate a spam score.
                      </p>
                      <dl class="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                        <dt class="text-dimmed">Flag</dt>
                        <dd class="break-all text-primary">{current().spam.flag ?? "Unavailable"}</dd>
                        <dt class="text-dimmed">Status</dt>
                        <dd class="break-all text-primary">{current().spam.status ?? "Unavailable"}</dd>
                        <dt class="text-dimmed">Score</dt>
                        <dd class="break-all text-primary">{current().spam.score ?? "Unavailable"}</dd>
                      </dl>
                    </section>
                  </Show>

                  <Show when={current().placements.length > 0}>
                    <section class="detail-section">
                      <p class="detail-section-label">Provider placements</p>
                      <div class="overflow-x-auto">
                        <table class="w-full min-w-[36rem] border-separate border-spacing-x-3 border-spacing-y-1 text-left text-xs">
                          <thead>
                            <tr>
                              <th>Folder</th>
                              <th>UID</th>
                              <th>UID validity</th>
                              <th>Flags</th>
                              <th>Provider keywords</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={current().placements}>
                              {(placement) => (
                                <tr>
                                  <td title={placement.remotePath}>{placement.folderName}</td>
                                  <td class="font-mono">{placement.uid}</td>
                                  <td class="font-mono">{placement.uidValidity}</td>
                                  <td>{placement.flags.join(", ") || "None"}</td>
                                  <td>{placement.keywords.join(", ") || "None"}</td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </Show>

                  <Show when={current().parts.length > 0}>
                    <section class="detail-section">
                      <p class="detail-section-label">MIME parts</p>
                      <div class="overflow-x-auto">
                        <table class="w-full min-w-[42rem] border-separate border-spacing-x-3 border-spacing-y-1 text-left text-xs">
                          <thead>
                            <tr>
                              <th>Part</th>
                              <th>Type</th>
                              <th>Disposition</th>
                              <th>Size</th>
                              <th>State</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={current().parts}>
                              {(part) => (
                                <tr>
                                  <td class="font-mono">{part.partPath}</td>
                                  <td>{part.contentType}</td>
                                  <td>{part.disposition ?? "Inline"}</td>
                                  <td>{formatFileViewSize(part.sizeBytes)}</td>
                                  <td>{part.hydrationStatus}</td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </Show>
                </Show>

                <Show when={tab() === "headers"}>
                  <section class="detail-section">
                    <div class="mb-3 flex items-center justify-between gap-2">
                      <p class="detail-section-label mb-0">All headers</p>
                      <span class="text-xs text-dimmed">{current().headers.length} fields</span>
                    </div>
                    <Show
                      when={current().headers.length > 0}
                      fallback={<Placeholder state="empty" variant="compact" title="No exact headers available" />}
                    >
                      <dl class="grid grid-cols-[minmax(7rem,12rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                        <For each={current().headers}>
                          {(header) => (
                            <>
                              <dt class="break-all font-medium text-primary">{header.name}</dt>
                              <dd class="break-all font-mono text-secondary">{header.value}</dd>
                            </>
                          )}
                        </For>
                      </dl>
                    </Show>
                    <Show when={current().rawHeaders}>
                      <details class="mt-4">
                        <summary class="cursor-pointer text-xs font-medium text-secondary">Raw header block</summary>
                        <pre class="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] p-3 font-mono text-xs text-secondary">
                          {current().rawHeaders}
                        </pre>
                      </details>
                    </Show>
                  </section>
                </Show>

                <Show when={tab() === "source"}>
                  <Show
                    when={current().source.available}
                    fallback={
                      <Placeholder
                        state="empty"
                        variant="panel"
                        title="Original source unavailable"
                        description="This message was mirrored before exact source storage was available, or its source could not be retained."
                      />
                    }
                  >
                    <Show
                      when={sourcePreview()}
                      fallback={
                        <Show
                          when={loadSourcePreview.error()}
                          fallback={<Placeholder state="loading" variant="panel" title="Loading source preview" />}
                        >
                          {(error) => (
                            <Placeholder
                              state="error"
                              variant="panel"
                              title="Could not load source preview"
                              description={error().message}
                              action={
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  type="button"
                                  disabled={loadSourcePreview.loading()}
                                  onClick={() => void loadSourcePreview.mutate(current().id)}
                                >
                                  <i class="ti ti-refresh" aria-hidden="true" /> Retry
                                </Button>
                              }
                            />
                          )}
                        </Show>
                      }
                    >
                      {(preview) => (
                        <section class="detail-section">
                          <div class="mb-3 flex items-center justify-between gap-2">
                            <div>
                              <p class="detail-section-label mb-0">Exact message source</p>
                              <p class="text-xs text-dimmed">
                                Showing {formatFileViewSize(preview().previewByteLength)} of {formatFileViewSize(preview().byteLength)}
                              </p>
                            </div>
                            <ButtonLink
                              variant="secondary"
                              size="sm"
                              href={sourceHref(props.mailboxId, current().id)}
                              download={downloadName()}
                            >
                              <i class="ti ti-download" aria-hidden="true" /> Download .eml
                            </ButtonLink>
                          </div>
                          <Show when={preview().truncated}>
                            <NoticeCard tone="neutral" icon={false} class="mb-3">
                              The on-screen preview is limited. The downloaded .eml contains the complete exact message.
                            </NoticeCard>
                          </Show>
                          <pre class="max-h-[32rem] overflow-auto whitespace-pre-wrap break-all rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] p-3 font-mono text-xs text-secondary">
                            {preview().text}
                          </pre>
                        </section>
                      )}
                    </Show>
                  </Show>
                </Show>
              </>
            )}
          </Show>
        </div>
      </PanelDialog.Body>
    </PanelDialog>
  );
}

export const openMailMessageInspector = (params: {
  mailboxId: string;
  messages: MessageDetail[];
  initialMessageId: string;
  initialTab?: InspectorTab;
}) =>
  dialogCore.open<void>(
    (close) => (
      <MailMessageInspectorDialog
        mailboxId={params.mailboxId}
        messages={params.messages}
        initialMessageId={params.initialMessageId}
        initialTab={params.initialTab ?? "overview"}
        close={() => close()}
      />
    ),
    panelDialogWorkspaceOptions,
  );
