/**
 * Attachment picker dialog — opened by `/file` slash command and the
 * footer paperclip button. Single mode: accepts any file type. The
 * `kind` (image vs file) is auto-detected server-side from the MIME
 * type and drives whether the markdown insertion is `![...]()` (block
 * image) or `[...]()` (inline file pill).
 *
 * Selecting (upload OR pick) dispatches `EDITOR_INSERT_ATTACHMENT_EVENT`
 * with {id, kind, filename}. The editor listens, inserts at cursor.
 */
import { fileIcons } from "@valentinkolb/stdlib";
import { dropzone } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { For, Show, createResource, createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import { EDITOR_INSERT_ATTACHMENT_EVENT } from "../detail/events";
import type { Attachment, AttachmentRef } from "./attachments-client";
import { formatBytes, uploadFile } from "./attachments-client";

type Props = {
  notebookId: string;
  close: () => void;
};

const fetchList = async (notebookId: string): Promise<Attachment[]> => {
  const res = await apiClient[":id"].attachments.$get({ param: { id: notebookId } });
  if (!res.ok) throw new Error(`Failed to load attachments (${res.status})`);
  return await res.json();
};

const dispatchInsert = (att: AttachmentRef) =>
  window.dispatchEvent(new CustomEvent(EDITOR_INSERT_ATTACHMENT_EVENT, { detail: att }));

const AttachmentPicker = (props: Props) => {
  const [list] = createResource(() => props.notebookId, fetchList);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // Sequential to keep order + UI feedback simple.
      for (const file of files) {
        const att = await uploadFile(props.notebookId, file);
        dispatchInsert({ id: att.id, shortId: att.shortId, kind: att.kind, filename: att.filename });
      }
      props.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const pick = (att: Attachment) => {
    dispatchInsert({ id: att.id, shortId: att.shortId, kind: att.kind, filename: att.filename });
    props.close();
  };

  const dz = dropzone.create({ onDrop: handleFiles });

  let fileInput: HTMLInputElement | undefined;

  return (
    <div class="w-full max-w-full flex flex-col gap-3">
      {/* Dropzone */}
      <button
        type="button"
        class={`flex flex-col items-center justify-center gap-1 rounded border-2 border-dashed py-6 text-xs transition-colors ${
          dz.invalidDrag()
            ? "border-red-400 bg-red-50 text-red-600 dark:border-red-500 dark:bg-red-950/30"
            : dz.isDragging()
              ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/30"
              : "border-zinc-300 dark:border-zinc-700 text-dimmed hover:border-zinc-400 dark:hover:border-zinc-600"
        }`}
        onClick={() => fileInput?.click()}
        disabled={busy()}
        {...dz.handlers}
      >
        <i class={`ti ${busy() ? "ti-loader-2 animate-spin" : "ti-cloud-upload"} text-base`} />
        <span>{busy() ? "Uploading…" : "Drop file or click to choose"}</span>
        <span class="text-[10px] opacity-70">Max 10 MB</span>
      </button>
      <input
        ref={fileInput}
        type="file"
        class="hidden"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          void handleFiles(files);
        }}
      />

      <Show when={error()}>
        <p class="text-xs text-red-600 dark:text-red-400">{error()}</p>
      </Show>

      {/* Existing attachments — pick to reuse without re-upload */}
      <Show when={(list() ?? []).length > 0}>
        <div class="flex flex-col gap-1">
          <p class="text-[11px] uppercase tracking-wide text-dimmed">Reuse existing</p>
          <ul class="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
            <For each={list() ?? []}>
              {(att) => (
                <li>
                  <button
                    type="button"
                    onClick={() => pick(att)}
                    class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left"
                  >
                    <i class={`ti ${fileIcons.getFileIcon({ name: att.filename, type: "file", mimeType: att.mimeType })} text-sm shrink-0`} />
                    <span class="flex-1 truncate">{att.filename}</span>
                    <span class="text-dimmed tabular-nums">{formatBytes(att.sizeBytes)}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
};

/** Open the picker dialog. Used by `/file` slash command + footer button. */
export const openAttachmentPicker = (notebookId: string): Promise<void> =>
  prompts.dialog<void>(
    (close) => <AttachmentPicker notebookId={notebookId} close={close} />,
    { title: "Attach", icon: "ti ti-paperclip" },
  ).then(() => undefined);
