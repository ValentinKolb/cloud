import { dialogCore, PanelDialog, panelDialogOptions, prompts, TagsInput, TextInput } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createResource, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DocumentLink, DocumentLinkListResponse, DocumentRunSummary } from "../../../contracts";
import { errorMessage } from "../utils/api-helpers";
import { openDocumentLinkDialog } from "./DocumentLinkDialog";
import { documentIconActionClass, formatDocumentDateTime, formatDocumentRelativeTime } from "./document-workspace-utils";

type DocumentRunDetailsDialogArgs = {
  run: DocumentRunSummary;
  canWrite: boolean;
  dateConfig?: DateContext;
  onSaved: (run: DocumentRunSummary) => void | Promise<void>;
  onDownload: (run: DocumentRunSummary) => void | Promise<void>;
};

const linkStatus = (link: DocumentLink): { label: string; class: string; active: boolean } => {
  if (link.revokedAt) return { label: "Revoked", class: "tag", active: false };
  if (new Date(link.expiresAt).getTime() <= Date.now()) return { label: "Expired", class: "tag", active: false };
  return { label: "Active", class: "tag-blue", active: true };
};

export const openDocumentRunDetailsDialog = (args: DocumentRunDetailsDialogArgs) =>
  dialogCore.open<void>((close) => <DocumentRunDetailsDialog args={args} close={close} />, panelDialogOptions);

function DocumentRunDetailsDialog(props: { args: DocumentRunDetailsDialogArgs; close: () => void }) {
  const [filename, setFilename] = createSignal(props.args.run.filename);
  const [tags, setTags] = createSignal<string[]>(props.args.run.tags);
  const [links, { refetch: refetchLinks }] = createResource(
    () => (props.args.canWrite ? props.args.run.id : null),
    async (runId): Promise<DocumentLink[]> => {
      if (!runId) return [];
      const res = await apiClient.documents.runs[":runId"].links.$get({ param: { runId } });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not load document links"));
      return ((await res.json()) as DocumentLinkListResponse).items;
    },
  );

  const saveMut = mutations.create<DocumentRunSummary, void>({
    mutation: async () => {
      const res = await apiClient.documents.runs[":runId"].$patch({
        param: { runId: props.args.run.id },
        json: { filename: filename().trim(), tags: tags() },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not update document"));
      return res.json();
    },
    onSuccess: async (run) => {
      await props.args.onSaved(run);
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  const revokeMut = mutations.create<DocumentLink, DocumentLink>({
    mutation: async (link) => {
      const res = await apiClient.documents.links[":linkId"].revoke.$post({ param: { linkId: link.id } });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not revoke document link"));
      return res.json();
    },
    onSuccess: async () => {
      await refetchLinks();
    },
    onError: (error) => prompts.error(error.message),
  });

  const createLink = () =>
    void openDocumentLinkDialog({
      run: props.args.run,
      onCreated: async () => {
        await refetchLinks();
      },
    });

  return (
    <PanelDialog>
      <PanelDialog.Header title="Document details" subtitle={props.args.run.filename} icon="ti ti-file-type-pdf" close={props.close} />
      <PanelDialog.Body>
        <section class="flex flex-col gap-2">
          <TextInput label="Filename" value={filename} onInput={setFilename} icon="ti ti-file-text" disabled={!props.args.canWrite} />
          <TagsInput label="Tags" placeholder="customer, signed, 2026" value={tags} onChange={setTags} disabled={!props.args.canWrite} />
          <dl class="grid gap-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
            <dt class="text-dimmed">Number</dt>
            <dd class="min-w-0 truncate font-mono text-xs text-secondary">{props.args.run.documentNumber}</dd>
            <dt class="text-dimmed">Created</dt>
            <dd class="text-secondary">{formatDocumentRelativeTime(props.args.run.generatedAt, props.args.dateConfig)}</dd>
            <dt class="text-dimmed">Snapshot</dt>
            <dd class="min-w-0 truncate font-mono text-xs text-secondary">{props.args.run.snapshotId}</dd>
          </dl>
        </section>
        <Show when={props.args.canWrite}>
          <section class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <div>
                <h3 class="text-sm font-semibold text-primary">Public links</h3>
                <p class="text-xs text-dimmed">Expiring download links for this stored document.</p>
              </div>
              <button type="button" class="btn-input btn-sm" onClick={createLink}>
                <i class="ti ti-link-plus" />
                New link
              </button>
            </div>
            <div class="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
              <Show when={!links.loading} fallback={<div class="p-3 text-sm text-dimmed">Loading links...</div>}>
                <Show
                  when={!links.error}
                  fallback={<div class="p-3 text-sm text-red-600">{links.error?.message ?? "Could not load links."}</div>}
                >
                  <Show
                    when={(links() ?? []).length > 0}
                    fallback={<div class="p-3 text-sm text-dimmed">No public links for this document.</div>}
                  >
                    <For each={links()}>
                      {(link) => {
                        const status = () => linkStatus(link);
                        return (
                          <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-zinc-100 px-3 py-2 last:border-b-0 dark:border-zinc-800">
                            <div class="min-w-0">
                              <div class="flex min-w-0 flex-wrap items-center gap-2">
                                <span class={status().class}>{status().label}</span>
                                <span class="text-xs text-secondary">
                                  Expires {formatDocumentDateTime(link.expiresAt, props.args.dateConfig)}
                                </span>
                              </div>
                              <Show when={link.comment}>{(comment) => <p class="mt-1 truncate text-sm text-primary">{comment()}</p>}</Show>
                              <p class="mt-1 text-xs text-dimmed">
                                Created {formatDocumentRelativeTime(link.createdAt, props.args.dateConfig)}
                                {link.accessCount > 0 ? ` · ${link.accessCount} downloads` : ""}
                                {link.lastAccessedAt
                                  ? ` · last ${formatDocumentRelativeTime(link.lastAccessedAt, props.args.dateConfig)}`
                                  : ""}
                              </p>
                            </div>
                            <Show when={status().active}>
                              <button
                                type="button"
                                class={documentIconActionClass}
                                title="Revoke link"
                                aria-label="Revoke link"
                                onClick={() => void revokeMut.mutate(link)}
                                disabled={revokeMut.loading()}
                              >
                                {revokeMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-link-off" />}
                              </button>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </Show>
              </Show>
            </div>
            <p class="text-xs text-dimmed">For security, the full URL is only shown when the link is created.</p>
          </section>
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <button
          type="button"
          class="btn-input btn-sm"
          onClick={() => void props.args.onDownload(props.args.run)}
          disabled={saveMut.loading()}
        >
          <i class="ti ti-download" />
          Download
        </button>
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={props.close} disabled={saveMut.loading()}>
            Close
          </button>
          <Show when={props.args.canWrite}>
            <button type="button" class="btn-primary btn-sm" onClick={() => saveMut.mutate(undefined)} disabled={saveMut.loading()}>
              {saveMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-device-floppy" />}
              Save
            </button>
          </Show>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}
