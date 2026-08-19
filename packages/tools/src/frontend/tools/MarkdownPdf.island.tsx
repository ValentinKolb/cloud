import { AutocompleteEditor, Button, MarkdownEditor, NoticeCard, Select, TextInput } from "@k2b/ui";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";

export type MarkdownPdfTemplateId = "document" | "report" | "compact" | "custom";

type MarkdownPdfViewProps = {
  initialMarkdown?: string;
  initialTemplateId?: MarkdownPdfTemplateId;
  initialCustomCss?: string;
  initialFilename?: string;
  initialError?: string;
  initialBusy?: boolean;
  initialPreviewUrl?: string;
};

const TEMPLATE_OPTIONS = [
  { id: "document", label: "Document", description: "Neutral typography and balanced A4 spacing." },
  { id: "report", label: "Report", description: "Formal headings, tables, and report styling." },
  { id: "compact", label: "Compact", description: "Dense layout for technical notes and runbooks." },
  { id: "custom", label: "Custom", description: "Use your own complete print stylesheet." },
];

export const MINIMAL_CUSTOM_CSS = `@page { size: A4; margin: 20mm; }

:root { color: #1f2937; font: 11pt/1.5 system-ui, sans-serif; }

body { margin: 0; }
.markdown-document { overflow-wrap: anywhere; }`;

const MAX_MARKDOWN_BYTES = 256 * 1024;
const MAX_CUSTOM_CSS_BYTES = 32 * 1024;
const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

export const markdownPdfFilename = (value: string): string => {
  const basename = value.split(/[\\/]/u).at(-1)?.trim() || "document";
  const clean = basename.replace(/[\r\n/:*?"<>|\\]/gu, "-").trim() || "document";
  if (clean.toLowerCase() === ".pdf") return "document.pdf";
  return clean.toLowerCase().endsWith(".pdf") ? clean.slice(0, 255) : `${clean.slice(0, 251)}.pdf`;
};

export const validateMarkdownPdfInput = (
  markdown: string,
  templateId: MarkdownPdfTemplateId,
  customCss: string,
  filename: string,
): string | null => {
  if (!markdown.trim()) return "Enter Markdown before generating a PDF.";
  if (byteLength(markdown) > MAX_MARKDOWN_BYTES) return "Markdown exceeds the 256 KiB limit.";
  if (templateId === "custom" && !customCss.trim()) return "Enter CSS for the Custom template.";
  if (templateId === "custom" && byteLength(customCss) > MAX_CUSTOM_CSS_BYTES) return "Custom CSS exceeds the 32 KiB limit.";
  if (!filename.trim()) return "Enter a PDF filename.";
  if (filename.length > 255) return "The filename must not exceed 255 characters.";
  return null;
};

const responseError = async (response: Response): Promise<string> => {
  if (response.status === 401) return "Sign in to generate PDFs.";
  if (response.status === 429) return "Too many PDF renders. Wait a moment and try again.";
  const data: unknown = await response.json().catch(() => null);
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message;
  return "The PDF could not be generated.";
};

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = markdownPdfFilename(filename);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};

export function MarkdownPdfView(props: MarkdownPdfViewProps = {}) {
  const [markdown, setMarkdown] = createSignal(props.initialMarkdown ?? "");
  const [templateId, setTemplateId] = createSignal<MarkdownPdfTemplateId>(props.initialTemplateId ?? "document");
  const [customCss, setCustomCss] = createSignal(
    props.initialCustomCss ?? (props.initialTemplateId === "custom" ? MINIMAL_CUSTOM_CSS : ""),
  );
  const [filename, setFilename] = createSignal(props.initialFilename ?? "document.pdf");
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(props.initialPreviewUrl ?? null);
  const [pdf, setPdf] = createSignal<Blob | null>(null);
  const [renderedInput, setRenderedInput] = createSignal("");
  const [error, setError] = createSignal(props.initialError ?? "");
  const [busy, setBusy] = createSignal(props.initialBusy ?? false);
  let request: AbortController | null = null;
  let requestRevision = 0;

  const currentInput = () => JSON.stringify([markdown(), templateId(), templateId() === "custom" ? customCss() : ""]);
  const stale = createMemo(() => Boolean(previewUrl() && renderedInput() && renderedInput() !== currentInput()));

  const revokePreview = () => {
    const current = previewUrl();
    if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
    setPreviewUrl(null);
  };

  const cancel = () => {
    requestRevision += 1;
    request?.abort();
    request = null;
    setBusy(false);
  };

  onCleanup(() => {
    cancel();
    revokePreview();
  });

  const generate = async () => {
    cancel();
    const validation = validateMarkdownPdfInput(markdown(), templateId(), customCss(), filename());
    if (validation) {
      setError(validation);
      return;
    }

    const revision = ++requestRevision;
    const controller = new AbortController();
    request = controller;
    setBusy(true);
    setError("");
    const snapshot = currentInput();
    const selectedTemplate = templateId();

    try {
      const response = await apiClient.markdown.pdf.$post(
        {
          json: {
            markdown: markdown(),
            templateId: selectedTemplate === "custom" ? undefined : selectedTemplate,
            customCss: selectedTemplate === "custom" ? customCss() : undefined,
            filename: markdownPdfFilename(filename()),
          },
        },
        { init: { signal: controller.signal } },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const blob = await response.blob();
      if (blob.type !== "application/pdf") throw new Error("The server returned an unexpected file type.");
      if (revision !== requestRevision) return;
      const nextUrl = URL.createObjectURL(blob);
      revokePreview();
      setPdf(blob);
      setPreviewUrl(nextUrl);
      setRenderedInput(snapshot);
    } catch (cause) {
      if (controller.signal.aborted || revision !== requestRevision) return;
      setError(cause instanceof Error ? cause.message : "The PDF could not be generated.");
    } finally {
      if (revision === requestRevision) {
        request = null;
        setBusy(false);
      }
    }
  };

  const download = () => {
    const value = pdf();
    if (value) downloadBlob(value, filename());
  };

  const openPreview = () => {
    const url = previewUrl();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const selectTemplate = (value: string | null) => {
    if (!value) return;
    const next = value as MarkdownPdfTemplateId;
    setTemplateId(next);
    if (next === "custom" && !customCss().trim()) setCustomCss(MINIMAL_CUSTOM_CSS);
  };

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-4" aria-labelledby="markdown-pdf-heading">
      <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(20rem,0.92fr)_minmax(0,1.08fr)]">
        <div class="flex min-h-0 flex-col gap-4">
          <div class="grid gap-3 sm:grid-cols-2">
            <Select label="Template" icon="ti ti-template" value={templateId} onValueChange={selectTemplate} options={TEMPLATE_OPTIONS} />
            <TextInput
              label="Filename"
              icon="ti ti-file-type-pdf"
              value={filename}
              onValueChange={setFilename}
              maxLength={255}
              spellcheck={false}
            />
          </div>

          <div class="h-[28rem] min-h-0 shrink-0 lg:h-auto lg:flex-1 lg:shrink">
            <MarkdownEditor
              label="Markdown"
              value={markdown}
              onValueChange={setMarkdown}
              placeholder="# Document title\n\nWrite or paste Markdown here…"
              lines={18}
              fill
              showStats
            />
          </div>

          <Show when={templateId() === "custom"}>
            <div>
              <AutocompleteEditor
                label="Custom CSS"
                description="This replaces the print template. External resources are not supported. Maximum 32 KiB."
                value={customCss}
                onValueChange={setCustomCss}
                placeholder={MINIMAL_CUSTOM_CSS}
                lines={8}
                spellcheck={false}
              />
            </div>
          </Show>

          <div class="flex items-start gap-2 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-3 py-2 text-xs leading-relaxed text-dimmed">
            <i class="ti ti-server mt-0.5 shrink-0" aria-hidden="true" />
            <p>Markdown and CSS are sent to this Cloud server. The input and generated PDF are processed in memory and are not stored.</p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void generate()} loading={busy()} loadingLabel="Generating PDF…">
              <i class="ti ti-file-type-pdf" aria-hidden="true" /> Generate PDF
            </Button>
            <Show when={busy()}>
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            </Show>
          </div>

          <Show when={error()}>
            <div role="alert">
              <NoticeCard tone="danger" title="PDF generation failed">
                {error()}
              </NoticeCard>
            </div>
          </Show>
        </div>

        <div class="flex min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-[var(--ui-radius-surface)] border border-[var(--ui-border)] bg-[var(--ui-surface)]">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ui-border)] px-4 py-3">
            <div class="min-w-0">
              <h2 id="markdown-pdf-heading" class="font-medium text-primary">
                PDF preview
              </h2>
              <p class="text-xs text-dimmed">A4 print output using the selected template.</p>
            </div>
            <Show when={previewUrl()}>
              <div class="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={openPreview}>
                  <i class="ti ti-external-link" aria-hidden="true" /> Open
                </Button>
                <Button variant="primary" size="sm" onClick={download} disabled={!pdf()}>
                  <i class="ti ti-download" aria-hidden="true" /> Download PDF
                </Button>
              </div>
            </Show>
          </div>

          <Show when={stale()}>
            <div class="border-b border-[var(--ui-border)] px-4 py-3">
              <NoticeCard tone="warning" title="Preview is out of date">
                Generate the PDF again to include your latest changes.
              </NoticeCard>
            </div>
          </Show>

          <Show
            when={previewUrl()}
            fallback={
              <div class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-dimmed">
                <i class="ti ti-file-type-pdf text-4xl" aria-hidden="true" />
                <p class="font-medium text-primary">No PDF generated yet</p>
                <p class="max-w-sm text-sm">Enter Markdown, choose a template, and generate a PDF to preview the final pages.</p>
              </div>
            }
          >
            {(url) => (
              <>
                <p class="k2b-sr-only" role="status">
                  PDF generation complete.
                </p>
                <iframe class="min-h-[28rem] flex-1 bg-white" src={url()} title="Generated PDF preview" />
              </>
            )}
          </Show>
        </div>
      </div>
    </section>
  );
}

export default function MarkdownPdf() {
  return <MarkdownPdfView />;
}
