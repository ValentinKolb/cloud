type PreviewDocumentTemplateInput = {
  templateId: string;
  recordId: string;
  signal?: AbortSignal;
};

type GenerateDocumentTemplateInput = PreviewDocumentTemplateInput & {
  filename?: string;
  tags?: string[];
};

const documentTemplateActionUrl = (templateId: string, action: "preview-pdf" | "generate") =>
  `/api/grids/documents/templates/${encodeURIComponent(templateId)}/${action}`;

export const requestDocumentTemplatePreview = (input: PreviewDocumentTemplateInput): Promise<Response> =>
  fetch(documentTemplateActionUrl(input.templateId, "preview-pdf"), {
    method: "POST",
    signal: input.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recordId: input.recordId }),
  });

export const requestDocumentTemplateGeneration = (input: GenerateDocumentTemplateInput): Promise<Response> =>
  fetch(documentTemplateActionUrl(input.templateId, "generate"), {
    method: "POST",
    signal: input.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recordId: input.recordId,
      filename: input.filename,
      tags: input.tags,
    }),
  });

export const requestDocumentRunDownload = (runId: string, signal?: AbortSignal): Promise<Response> =>
  fetch(`/api/grids/documents/runs/${encodeURIComponent(runId)}/download`, signal ? { signal } : undefined);

export const isPdfResponse = (response: Response): boolean =>
  response.ok && (response.headers.get("content-type") ?? "").toLowerCase().includes("application/pdf");
