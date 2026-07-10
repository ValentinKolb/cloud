import type { ExportBody } from "../../../contracts";

export const requestRecordExport = (tableId: string, body: ExportBody, signal?: AbortSignal): Promise<Response> =>
  fetch(`/api/grids/records/by-table/${encodeURIComponent(tableId)}/export`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const uploadRecordFile = (input: {
  tableId: string;
  recordId: string;
  fieldId: string;
  file: File;
  signal?: AbortSignal;
}): Promise<Response> => {
  const form = new FormData();
  form.set("file", input.file);
  return fetch(
    `/api/grids/records/${encodeURIComponent(input.tableId)}/${encodeURIComponent(input.recordId)}/files/${encodeURIComponent(input.fieldId)}`,
    { method: "POST", signal: input.signal, body: form },
  );
};
