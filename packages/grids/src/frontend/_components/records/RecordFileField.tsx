import { prompts, Tooltip } from "@valentinkolb/cloud/ui";
import { fileIcons, text } from "@valentinkolb/stdlib";
import { showFileDialog } from "@valentinkolb/stdlib/browser";
import { createEffect, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, GridFile } from "../../../service";
import { errorMessage } from "../utils/api-helpers";
import { uploadRecordFile } from "./record-transfer-client";

export default function RecordFileField(props: {
  tableId: string;
  recordId: string;
  field: Field;
  canWrite: boolean;
  initialFiles: GridFile[];
}) {
  const [uploading, setUploading] = createSignal(false);
  const [files, setFiles] = createSignal<GridFile[]>(props.initialFiles);

  createEffect(() => setFiles(props.initialFiles));

  const refetch = async () => {
    const res = await apiClient.records[":tableId"][":recordId"].files[":fieldId"].$get({
      param: { tableId: props.tableId, recordId: props.recordId, fieldId: props.field.id },
    });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to load files"));
    setFiles(((await res.json()) as { items: GridFile[] }).items);
  };

  const accept = () => {
    const raw = (props.field.config as { accept?: string[] }).accept;
    return Array.isArray(raw) ? raw.join(",") : undefined;
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const res = await uploadRecordFile({
        tableId: props.tableId,
        recordId: props.recordId,
        fieldId: props.field.id,
        file,
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to upload file"));
      await refetch();
    } catch (e) {
      prompts.error(e instanceof Error ? e.message : "Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const chooseFile = async () => {
    if (uploading()) return;
    try {
      await upload(await showFileDialog({ accept: accept() }));
    } catch (error) {
      if (error instanceof Error && (error.message === "File dialog cancelled" || error.message === "No file selected")) {
        return;
      }
      prompts.error(error instanceof Error ? error.message : "Could not open the file picker");
    }
  };

  const remove = async (file: GridFile) => {
    const confirmed = await prompts.confirm(`Delete "${file.filename}"?`, {
      title: "Delete file?",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!confirmed) return;
    const res = await apiClient.records[":tableId"][":recordId"].files[":fieldId"][":fileId"].$delete({
      param: { tableId: props.tableId, recordId: props.recordId, fieldId: props.field.id, fileId: file.id },
    });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to delete file"));
      return;
    }
    await refetch();
  };

  return (
    <div class="flex flex-col gap-2">
      <Show when={files().length === 0}>
        <span class="text-dimmed">—</span>
      </Show>
      <Show when={files().length > 0}>
        <div class="flex flex-col gap-1">
          <For each={files()}>
            {(file) => (
              <div class="group flex min-w-0 items-center gap-2 py-1 text-sm">
                <i
                  aria-hidden="true"
                  class={`ti ${fileIcons.getFileIcon({
                    name: file.filename,
                    type: "file",
                    mimeType: file.mimeType,
                  })} shrink-0 text-base`}
                />
                <Tooltip content={file.filename} class="min-w-0 flex-1">
                  <a
                    class="min-w-0 flex-1 truncate text-secondary transition-colors hover:text-primary"
                    href={`/api/grids/records/${props.tableId}/${props.recordId}/files/${props.field.id}/${file.id}/content`}
                  >
                    {file.filename}
                  </a>
                </Tooltip>
                <span class="shrink-0 text-xs text-dimmed">{text.pprintBytes(file.sizeBytes)}</span>
                <Show when={props.canWrite}>
                  <Tooltip content="Delete file">
                    <button
                      type="button"
                      class="btn-simple btn-sm text-dimmed hover:text-red-500"
                      aria-label={`Delete ${file.filename}`}
                      onClick={() => void remove(file)}
                    >
                      <i class="ti ti-trash" />
                    </button>
                  </Tooltip>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.canWrite}>
        <button
          type="button"
          class="btn-input btn-input-sm w-fit"
          disabled={uploading()}
          aria-busy={uploading()}
          onClick={() => void chooseFile()}
        >
          <i aria-hidden="true" class={`ti ${uploading() ? "ti-loader-2 animate-spin" : "ti-upload"} text-sm`} />
          Upload
        </button>
      </Show>
    </div>
  );
}
