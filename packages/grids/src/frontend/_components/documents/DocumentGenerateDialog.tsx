import { dialogCore, PanelDialog, PdfPreview, panelDialogOptions, prompts, TagsInput, TextInput } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal } from "solid-js";
import type { DocumentTemplateSummary } from "../../../contracts";
import type { Table } from "../../../service";
import RecordPicker from "../records/RecordPicker";
import { downloadPdfResponse } from "./document-download";
import { isPdfResponse, requestDocumentTemplateGeneration, requestDocumentTemplatePreview } from "./document-transfer-client";

export type DocumentGenerateDialogArgs = {
  table: Table;
  template: DocumentTemplateSummary;
  initialRecordId: string | null;
  onGenerated: () => void | Promise<void>;
};

const options = {
  ...panelDialogOptions,
  panelClassName: `${panelDialogOptions.panelClassName} h-[min(90vh,54rem)] w-[min(96vw,80rem)]`,
  contentClassName: "flex h-full min-h-0 p-0",
};

export const openDocumentGenerateDialog = (args: DocumentGenerateDialogArgs) =>
  dialogCore.open<void>((close) => <DocumentGenerateDialog args={args} close={close} />, options);

function DocumentGenerateDialog(props: { args: DocumentGenerateDialogArgs; close: () => void }) {
  const [recordId, setRecordId] = createSignal(props.args.initialRecordId ?? "");
  const [filename, setFilename] = createSignal("");
  const [tags, setTags] = createSignal<string[]>([]);
  const [previewedRecordId, setPreviewedRecordId] = createSignal<string | null>(null);

  const setSelectedRecord = (next: string) => {
    setRecordId(next);
    setPreviewedRecordId(null);
  };
  const hasCurrentPreview = () => {
    const selected = recordId().trim();
    return selected.length > 0 && previewedRecordId() === selected;
  };
  const previewPdf = async () => {
    const selected = recordId().trim();
    if (!selected) throw new Error("Choose a record first.");
    setPreviewedRecordId(null);
    const res = await requestDocumentTemplatePreview({ templateId: props.args.template.id, recordId: selected });
    if (isPdfResponse(res)) setPreviewedRecordId(selected);
    return res;
  };

  const generateMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const selected = recordId().trim();
      if (!selected) throw new Error("Choose a record first.");
      if (!hasCurrentPreview()) throw new Error("Render a PDF preview before generating this document.");
      const res = await requestDocumentTemplateGeneration({
        templateId: props.args.template.id,
        recordId: selected,
        filename: filename().trim() || undefined,
        tags: tags(),
        signal: abortSignal,
      });
      await downloadPdfResponse(res, filename().trim() || `${props.args.template.name}.pdf`);
    },
    onSuccess: async () => {
      await props.args.onGenerated();
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={`Generate — ${props.args.template.name}`}
        subtitle={props.args.table.name}
        icon="ti ti-file-type-pdf"
        close={props.close}
      />
      <PanelDialog.Body>
        <section class="flex shrink-0 flex-col gap-2">
          <RecordPicker
            tableId={props.args.table.id}
            templateId={props.args.template.id}
            value={recordId}
            onChange={setSelectedRecord}
            label="Record"
            placeholder="Search records..."
          />
          <TextInput
            label="Filename"
            description="Optional override. Leave empty to use the template's Liquid filename pattern."
            value={filename}
            onInput={setFilename}
            icon="ti ti-file-text"
            placeholder="Use template default"
          />
          <TagsInput label="Tags" placeholder="customer, signed, 2026" value={tags} onChange={setTags} />
          <div class="info-block-info text-xs">
            <i class="ti ti-camera" />
            Generating stores a recursive snapshot. Redownloads use the stored snapshot and filename.
          </div>
        </section>
        <PdfPreview
          title="PDF preview"
          class="min-h-[30rem] shrink-0"
          buttonLabel="Render preview"
          emptyText="Choose a record and render a PDF preview before generating."
          disabled={() => !recordId().trim()}
          request={previewPdf}
        />
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={props.close} disabled={generateMut.loading()}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={() => generateMut.mutate(undefined)}
            disabled={generateMut.loading() || !hasCurrentPreview()}
          >
            {generateMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
            Generate PDF
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}
