import { AutocompleteEditor, Button, dialogCore, NoticeCard, PanelDialog, panelDialogOptions, Select } from "@k2b/ui";
import { createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";

type NotePdfTemplateId = "document" | "report" | "compact" | "custom";

type NotePdfDialogProps = {
  notebookId: string;
  noteId: string;
  noteTitle: string;
  markdown: string;
};

const TEMPLATE_OPTIONS = [
  { id: "document", label: "Document", description: "Neutral typography and balanced A4 spacing." },
  { id: "report", label: "Report", description: "Formal headings, tables, and report styling." },
  { id: "compact", label: "Compact", description: "Dense layout for technical notes and runbooks." },
  { id: "custom", label: "Custom", description: "Use your own complete print stylesheet." },
];

const MAX_MARKDOWN_BYTES = 256 * 1024;
const MAX_CUSTOM_CSS_BYTES = 32 * 1024;
const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

export const MINIMAL_NOTE_PDF_CSS = `@page { size: A4; margin: 20mm; }

:root { color: #1f2937; font: 11pt/1.5 system-ui, sans-serif; }

body { margin: 0; }
.markdown-document { overflow-wrap: anywhere; }`;

const pdfFilename = (title: string): string => {
  const clean =
    title
      .replace(/[\r\n/:*?"<>|\\]/gu, "-")
      .replace(/\s+/gu, " ")
      .trim() || "note";
  return `${clean.slice(0, 251)}.pdf`;
};

const responseError = async (response: Response): Promise<string> => {
  if (response.status === 429) return "Too many PDF requests. Wait a moment and try again.";
  const data: unknown = await response.json().catch(() => null);
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message;
  return "The PDF could not be generated.";
};

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};

function NotePdfDialog(props: NotePdfDialogProps & { close: () => void }) {
  const [templateId, setTemplateId] = createSignal<NotePdfTemplateId>("document");
  const [customCss, setCustomCss] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  let request: AbortController | null = null;

  const close = () => {
    request?.abort();
    props.close();
  };
  onCleanup(() => request?.abort());

  const selectTemplate = (value: string | null) => {
    if (!value) return;
    const next = value as NotePdfTemplateId;
    setTemplateId(next);
    if (next === "custom" && !customCss().trim()) setCustomCss(MINIMAL_NOTE_PDF_CSS);
  };

  const generate = async () => {
    if (!props.markdown.trim()) {
      setError("This note has no Markdown content to export.");
      return;
    }
    if (byteLength(props.markdown) > MAX_MARKDOWN_BYTES) {
      setError("This note exceeds the 256 KiB PDF export limit.");
      return;
    }
    if (templateId() === "custom" && !customCss().trim()) {
      setError("Enter CSS for the Custom template.");
      return;
    }
    if (templateId() === "custom" && byteLength(customCss()) > MAX_CUSTOM_CSS_BYTES) {
      setError("Custom CSS exceeds the 32 KiB limit.");
      return;
    }

    request?.abort();
    const controller = new AbortController();
    request = controller;
    setBusy(true);
    setError("");
    const selectedTemplate = templateId();
    try {
      const response = await apiClient[":id"].notes[":noteId"].pdf.$post(
        {
          param: { id: props.notebookId, noteId: props.noteId },
          json: {
            markdown: props.markdown,
            templateId: selectedTemplate === "custom" ? undefined : selectedTemplate,
            customCss: selectedTemplate === "custom" ? customCss() : undefined,
          },
        },
        { init: { signal: controller.signal } },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const blob = await response.blob();
      if (blob.type !== "application/pdf") throw new Error("The server returned an unexpected file type.");
      downloadBlob(blob, pdfFilename(props.noteTitle));
      props.close();
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The PDF could not be generated.");
    } finally {
      if (request === controller) {
        request = null;
        setBusy(false);
      }
    }
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Download PDF"
        subtitle={`Choose how ${props.noteTitle || "this note"} should be formatted.`}
        icon="ti ti-file-type-pdf"
        close={close}
      />
      <PanelDialog.Body>
        <PanelDialog.Section title="Print style" subtitle="All built-in templates use A4." icon="ti ti-template">
          <div class="flex flex-col gap-4">
            <Select label="Template" icon="ti ti-template" value={templateId} onValueChange={selectTemplate} options={TEMPLATE_OPTIONS} />
            <Show when={templateId() === "custom"}>
              <AutocompleteEditor
                label="Custom CSS"
                description="This replaces the print template. External resources are not supported. Maximum 32 KiB."
                value={customCss}
                onValueChange={setCustomCss}
                placeholder={MINIMAL_NOTE_PDF_CSS}
                lines={9}
                spellcheck={false}
              />
            </Show>
            <p class="flex items-start gap-2 text-xs leading-relaxed text-dimmed">
              <i class="ti ti-server mt-0.5 shrink-0" aria-hidden="true" />
              <span>The current note and CSS are processed in memory and are not stored as a PDF.</span>
            </p>
            <Show when={error()}>
              <div role="alert">
                <NoticeCard tone="danger" title="PDF generation failed">
                  {error()}
                </NoticeCard>
              </div>
            </Show>
          </div>
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <Button type="button" variant="secondary" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => void generate()} loading={busy()} loadingLabel="Generating PDF…">
          <i class="ti ti-download" aria-hidden="true" /> Download PDF
        </Button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const openNotePdfDialog = (props: NotePdfDialogProps): Promise<void> =>
  dialogCore.open<void>((close) => <NotePdfDialog {...props} close={() => close()} />, panelDialogOptions);
