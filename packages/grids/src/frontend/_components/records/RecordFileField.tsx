import { prompts } from "@valentinkolb/cloud/ui";
import { text } from "@valentinkolb/stdlib";
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

  const upload = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
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
              <div class="paper flex items-center gap-2 px-2.5 py-1.5 text-xs">
                <i class="ti ti-paperclip text-dimmed" />
                <a
                  class="min-w-0 flex-1 truncate text-secondary hover:text-primary"
                  href={`/api/grids/records/${props.tableId}/${props.recordId}/files/${props.field.id}/${file.id}/content`}
                  title={file.filename}
                >
                  {file.filename}
                </a>
                <span class="shrink-0 text-[10px] text-dimmed">{text.pprintBytes(file.sizeBytes)}</span>
                <Show when={props.canWrite}>
                  <button
                    type="button"
                    class="btn-simple btn-sm text-dimmed hover:text-red-500"
                    title="Delete file"
                    onClick={() => void remove(file)}
                  >
                    <i class="ti ti-trash" />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.canWrite}>
        <label class={`btn-input btn-input-sm w-fit ${uploading() ? "pointer-events-none opacity-60" : ""}`}>
          <i class={`ti ${uploading() ? "ti-loader-2 animate-spin" : "ti-upload"} text-sm`} />
          Upload
          <input type="file" class="sr-only" accept={accept()} onChange={(event) => void upload(event)} disabled={uploading()} />
        </label>
      </Show>
    </div>
  );
}
