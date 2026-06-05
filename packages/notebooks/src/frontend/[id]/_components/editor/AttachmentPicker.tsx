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

import { FileDropzone, prompts } from "@valentinkolb/cloud/ui";
import { fileIcons } from "@valentinkolb/stdlib";
import { createResource, createSignal, For, Show } from "solid-js";
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

const dispatchInsert = (att: AttachmentRef) => window.dispatchEvent(new CustomEvent(EDITOR_INSERT_ATTACHMENT_EVENT, { detail: att }));

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

  return (
    <div class="w-full max-w-full flex flex-col gap-3">
      <FileDropzone
        title="Drop file or click to choose"
        subtitle="Upload a new attachment and insert it at the cursor."
        hint="Max 10 MB"
        busy={busy}
        onDrop={handleFiles}
      />

      <Show when={error()}>
        <p class="text-xs text-red-600 dark:text-red-400">{error()}</p>
      </Show>

      {/* Existing attachments — pick to reuse without re-upload */}
      <Show when={(list() ?? []).length > 0}>
        <div class="flex flex-col gap-1.5">
          <p class="text-[11px] font-medium uppercase tracking-wide text-dimmed">Reuse existing</p>
          <ul class="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
            <For each={list() ?? []}>
              {(att) => (
                <li>
                  <button type="button" onClick={() => pick(att)} class="list-item w-full !px-2 !py-1.5 text-left text-xs">
                    <i
                      class={`ti ${fileIcons.getFileIcon({ name: att.filename, type: "file", mimeType: att.mimeType })} text-sm shrink-0`}
                    />
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
  prompts
    .dialog<void>((close) => <AttachmentPicker notebookId={notebookId} close={close} />, { title: "Attach", icon: "ti ti-paperclip" })
    .then(() => undefined);
