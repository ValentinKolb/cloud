import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, dialogCore, NoticeCard, PanelDialog, PdfPreview, panelDialogWideOptions, prompts, TagsInput, TextInput } from "@k2b/ui";
import { createSignal } from "solid-js";
import type { PublicTable as Table } from "../../../api/public-dto";
import RecordPicker from "../records/RecordPicker";
import { downloadPdfResponse } from "./document-download";
import { isPdfResponse, requestDocumentTemplateGeneration, requestDocumentTemplatePreview } from "./document-transfer-client";
import type { PublicDocumentTemplateSummary } from "./public-document-types";

type DocumentGenerateDialogArgs = {
  table: Table;
  template: PublicDocumentTemplateSummary;
  initialRecordId: string | null;
  onGenerated: () => void | Promise<void>;
};

export const openDocumentGenerateDialog = (args: DocumentGenerateDialogArgs) =>
  dialogCore.open<void>((close) => <DocumentGenerateDialog args={args} close={close} />, panelDialogWideOptions);

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
            onValueChange={setFilename}
            icon="ti ti-file-text"
            placeholder="Use template default"
          />
          <TagsInput label="Tags" placeholder="customer, signed, 2026" value={tags} onValueChange={setTags} />
          <NoticeCard tone="info" icon={false}>
            <i class="ti ti-camera" />
            Generating stores a recursive snapshot. Redownloads use the stored snapshot and filename.
          </NoticeCard>
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
          <Button variant="secondary" size="sm" type="button" onClick={props.close} disabled={generateMut.loading()}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="button"
            onClick={() => generateMut.mutate(undefined)}
            disabled={generateMut.loading() || !hasCurrentPreview()}
          >
            {generateMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
            Generate PDF
          </Button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}
