/**
 * Attachments overview — notebook-wide tile grid with per-tile actions
 * (download / copy markdown / delete). Lives at /app/notebooks/<id>/attachments.
 *
 * Images render as actual thumbnails (lazy-loaded), non-image attachments
 * as file-icon tiles in the same grid. KISS: no thumbnail generation
 * server-side — the browser does the work via `<img loading="lazy">` and
 * the API's content endpoint streams the bytea blob with the right
 * Content-Disposition.
 *
 * Delete is the only path that wipes a blob. After delete, broken refs in
 * other notes stay broken by design (KISS — see dex task `vnzej6v5`).
 */
import { fileIcons } from "@valentinkolb/stdlib";
import { clipboard } from "@valentinkolb/stdlib/browser";
import { Placeholder, prompts } from "@valentinkolb/cloud/ui";
import { For, Show, createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import {
  type Attachment,
  attachmentMarkdown,
  buildAttachmentContentUrl,
  confirmAndDownload,
  formatBytes,
} from "../editor/attachments-client";

type Props = {
  notebookId: string;
  initial: Attachment[];
  /** Active search query — used to differentiate empty states. */
  searchQuery: string;
};

const AttachmentsOverview = (props: Props) => {
  const [items, setItems] = createSignal<Attachment[]>(props.initial);

  const onDownload = (att: Attachment) =>
    void confirmAndDownload(
      att.filename,
      buildAttachmentContentUrl(props.notebookId, att.shortId)
    );

  const onCopy = async (att: Attachment) => {
    await clipboard.copy(
      attachmentMarkdown({ id: att.id, shortId: att.shortId, kind: att.kind, filename: att.filename })
    );
    // Lightweight feedback — `prompts.alert` is the platform-standard
    // confirmation surface (used by oauth/contacts/core etc.).
    await prompts.alert(`Markdown for "${att.filename}" copied to clipboard.`, {
      title: "Copied",
      icon: "ti ti-clipboard-check",
    });
  };

  const onDelete = async (att: Attachment) => {
    const usageRes = await apiClient[":id"].attachments[":attId"].usage.$get({
      param: { id: props.notebookId, attId: att.shortId },
    });
    if (!usageRes.ok) {
      await prompts.error("Failed to check attachment usage");
      return;
    }
    const { count } = await usageRes.json();

    const message =
      count > 0
        ? `"${att.filename}" is referenced in ${count} note${
            count === 1 ? "" : "s"
          }. Delete anyway? Existing references will become broken links.`
        : `Delete "${att.filename}"?`;

    const ok = await prompts.confirm(message, {
      title: "Delete attachment",
      icon: "ti ti-trash",
      confirmText: "Delete",
      variant: "danger",
    });
    if (!ok) return;

    const delRes = await apiClient[":id"].attachments[":attId"].$delete({
      param: { id: props.notebookId, attId: att.shortId },
    });
    if (!delRes.ok) {
      const data = (await delRes.json().catch(() => null)) as {
        message?: string;
      } | null;
      await prompts.error(data?.message ?? "Failed to delete attachment");
      return;
    }

    setItems((prev) => prev.filter((a) => a.id !== att.id));
  };

  return (
    <Show
      when={items().length > 0}
      fallback={
        props.searchQuery ? (
          <Placeholder surface="paper" icon="ti ti-paperclip">
            No attachments match "{props.searchQuery}".
          </Placeholder>
        ) : (
          <Placeholder
            surface="paper"
            icon="ti ti-paperclip"
            title="No attachments yet."
            description={<>Drop files into the editor or use the <span class="font-mono">/file</span> command.</>}
          />
        )
      }
    >
        <ul class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 2xl:grid-cols-16 gap-2">
          <For each={items()}>
            {(att) => (
              <li class="paper group relative flex flex-col overflow-hidden">
                {/* Preview area — fixed square box. Thumbnail / icon sits
                    absolutely inside it so portrait/landscape images can
                    never push the tile out of square (otherwise
                    `aspect-ratio` grows when the intrinsic image is
                    taller than wide). Action buttons overlay on hover —
                    at this tile width the meta row has no room for them. */}
                <div class="relative aspect-square overflow-hidden bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
                  {att.kind === "image" ? (
                    <img
                      src={buildAttachmentContentUrl(props.notebookId, att.shortId)}
                      alt={att.filename}
                      loading="lazy"
                      class="absolute inset-0 w-full h-full object-contain"
                    />
                  ) : (
                    <div class="absolute inset-0 flex items-center justify-center">
                      <i
                        class={`ti ${fileIcons.getFileIcon({
                          name: att.filename,
                          type: "file",
                          mimeType: att.mimeType,
                        })} text-2xl`}
                      />
                    </div>
                  )}

                  {/* Hover overlay: download / copy / delete. Sits on the
                      preview so meta row stays clean (filename + size). */}
                  <div class="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => onDownload(att)}
                      title="Download"
                      class="w-6 h-6 inline-flex items-center justify-center rounded bg-white/90 dark:bg-zinc-950/80 backdrop-blur-sm text-dimmed hover:text-primary shadow-sm"
                    >
                      <i class="ti ti-download text-xs" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onCopy(att)}
                      title="Copy markdown"
                      class="w-6 h-6 inline-flex items-center justify-center rounded bg-white/90 dark:bg-zinc-950/80 backdrop-blur-sm text-dimmed hover:text-primary shadow-sm"
                    >
                      <i class="ti ti-copy text-xs" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(att)}
                      title="Delete"
                      class="w-6 h-6 inline-flex items-center justify-center rounded bg-white/90 dark:bg-zinc-950/80 backdrop-blur-sm text-dimmed hover:text-red-500 shadow-sm"
                    >
                      <i class="ti ti-trash text-xs" />
                    </button>
                  </div>
                </div>

                {/* Meta — filename + size only. Actions live on the preview. */}
                <div class="flex flex-col gap-0.5 px-1.5 py-1">
                  <p class="text-[11px] leading-tight truncate" title={att.filename}>
                    {att.filename}
                  </p>
                  <p class="text-[10px] text-dimmed tabular-nums">{formatBytes(att.sizeBytes)}</p>
                </div>
              </li>
            )}
          </For>
        </ul>
    </Show>
  );
};

export default AttachmentsOverview;
