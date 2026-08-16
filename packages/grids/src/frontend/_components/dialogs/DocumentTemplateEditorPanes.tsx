import { Panes, type PanesLayout, PdfPreview, TemplateEditor, type TemplateVariable } from "@k2b/ui";
import { type Accessor, createSignal } from "solid-js";
import type { DocumentPreviewResponse } from "../../../contracts";
import { DocumentDataTree, RenderedDocumentSource } from "./DocumentTemplatePreviewData";

type TemplateSnippet = {
  id: string;
  title: string;
  icon: string;
  value: Accessor<string>;
  onInput: (value: string) => void;
  placeholder: string;
};

type Props = {
  html: Accessor<string>;
  setHtml: (value: string) => void;
  headerHtml: Accessor<string>;
  setHeaderHtml: (value: string) => void;
  footerHtml: Accessor<string>;
  setFooterHtml: (value: string) => void;
  pageCss: Accessor<string>;
  setPageCss: (value: string) => void;
  templateVariables: Accessor<TemplateVariable[]>;
  previewData: Accessor<DocumentPreviewResponse | null>;
  previewDataLoading: Accessor<boolean>;
  previewDataError: Accessor<string | null>;
  source: Accessor<string>;
  previewRecordId: Accessor<string>;
  previewPdf: () => Promise<Response>;
};

const createPanesLayout = (): PanesLayout => ({
  version: 2,
  root: {
    type: "split",
    direction: "horizontal",
    ratio: 0.58,
    first: { type: "group", items: ["html", "header", "footer", "css"], active: "html" },
    second: { type: "group", items: ["preview", "data", "source"], active: "preview" },
  },
});

export function DocumentTemplateEditorPanes(props: Props) {
  const [layout, setLayout] = createSignal(createPanesLayout());
  const snippets: TemplateSnippet[] = [
    {
      id: "html",
      title: "Body",
      icon: "ti ti-code",
      value: props.html,
      onInput: props.setHtml,
      placeholder: "Write the main document HTML...",
    },
    {
      id: "header",
      title: "Header",
      icon: "ti ti-layout-navbar",
      value: props.headerHtml,
      onInput: props.setHeaderHtml,
      placeholder: "Optional Gotenberg header HTML...",
    },
    {
      id: "footer",
      title: "Footer",
      icon: "ti ti-layout-bottombar",
      value: props.footerHtml,
      onInput: props.setFooterHtml,
      placeholder: "Optional Gotenberg footer HTML...",
    },
    {
      id: "css",
      title: "Page CSS",
      icon: "ti ti-braces",
      value: props.pageCss,
      onInput: props.setPageCss,
      placeholder: "@page { size: A4; margin: 28mm 14mm 22mm; }",
    },
  ];
  const items = [
    ...snippets.map((snippet) => ({
      id: snippet.id,
      title: snippet.title,
      icon: snippet.icon,
      render: () => (
        <section class="flex h-full min-h-0 flex-col overflow-hidden">
          <TemplateEditor
            value={snippet.value}
            onValueChange={snippet.onInput}
            variables={props.templateVariables()}
            fill
            placeholder={snippet.placeholder}
          />
        </section>
      ),
    })),
    {
      id: "preview",
      title: "Preview",
      icon: "ti ti-file-type-pdf",
      render: () => (
        <section class="flex h-full min-h-0 flex-col overflow-hidden">
          <PdfPreview
            title="Gotenberg PDF preview"
            class="min-h-0 flex-1"
            buttonLabel="Render preview"
            emptyText="Choose a record and render a PDF preview from the unsaved draft."
            disabled={() => !props.source().trim() || !props.html().trim() || !props.previewRecordId().trim()}
            request={props.previewPdf}
          />
        </section>
      ),
    },
    {
      id: "data",
      title: "Data",
      icon: "ti ti-list-tree",
      render: () => (
        <section class="flex h-full min-h-0 flex-col overflow-hidden">
          <DocumentDataTree
            data={() => props.previewData()?.data ?? null}
            loading={props.previewDataLoading}
            error={props.previewDataError}
          />
        </section>
      ),
    },
    {
      id: "source",
      title: "Source",
      icon: "ti ti-code",
      render: () => (
        <section class="flex h-full min-h-0 flex-col overflow-hidden">
          <RenderedDocumentSource
            source={() => props.previewData()?.source ?? null}
            loading={props.previewDataLoading}
            error={props.previewDataError}
          />
        </section>
      ),
    },
  ];

  return (
    <Panes layout={layout()} onLayoutChange={setLayout} items={items} class="min-h-[24rem] w-full flex-1" movable={false} split={false} />
  );
}
