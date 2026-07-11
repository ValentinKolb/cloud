import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { Panes, type PanesValue, PdfPreview, TemplateEditor, type TemplateVariable } from "@valentinkolb/cloud/ui";
import { type Accessor, createMemo, createSignal, For, Show } from "solid-js";
import type { DocumentPreviewResponse, DocumentTemplate } from "../../../contracts";
import { ScopedPermissionEditor } from "../permissions/ScopedPermissionEditor";
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
  template?: DocumentTemplate;
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
  accessEntries: Accessor<AccessEntry[]>;
  accessLoading: Accessor<boolean>;
};

const createPanesValue = (): PanesValue => ({
  root: {
    type: "split",
    id: "document-template-split",
    direction: "horizontal",
    sizes: [58, 42],
    children: [
      {
        type: "leaf",
        id: "document-template-html",
        elementIds: ["html", "header", "footer", "css"],
        activeElementId: "html",
        presentation: "tabs",
      },
      {
        type: "leaf",
        id: "document-template-preview",
        elementIds: ["preview", "data", "source", "permissions"],
        activeElementId: "preview",
        presentation: "tabs",
      },
    ],
  },
});

export function DocumentTemplateEditorPanes(props: Props) {
  const [panes, setPanes] = createSignal<PanesValue>(createPanesValue());
  const snippets = createMemo<TemplateSnippet[]>(() => [
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
  ]);

  return (
    <Panes.Root
      value={panes()}
      onChange={setPanes}
      class="min-h-[24rem] w-full flex-1"
      allowResize
      allowMove={false}
      allowReorder={false}
      allowHorizontalSplit={false}
      allowVerticalSplit={false}
      leafPresentation="single"
    >
      <For each={snippets()}>
        {(snippet) => (
          <Panes.Element id={snippet.id} title={snippet.title} icon={snippet.icon}>
            <section class="flex h-full min-h-0 flex-col overflow-hidden">
              <TemplateEditor
                value={snippet.value}
                onInput={snippet.onInput}
                variables={props.templateVariables()}
                fill
                placeholder={snippet.placeholder}
              />
            </section>
          </Panes.Element>
        )}
      </For>

      <Panes.Element id="preview" title="Preview" icon="ti ti-file-type-pdf">
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
      </Panes.Element>
      <Panes.Element id="data" title="Data" icon="ti ti-list-tree">
        <section class="flex h-full min-h-0 flex-col overflow-hidden">
          <DocumentDataTree
            data={() => props.previewData()?.data ?? null}
            loading={props.previewDataLoading}
            error={props.previewDataError}
          />
        </section>
      </Panes.Element>
      <Panes.Element id="source" title="Source" icon="ti ti-code">
        <section class="flex h-full min-h-0 flex-col overflow-hidden">
          <RenderedDocumentSource
            source={() => props.previewData()?.source ?? null}
            loading={props.previewDataLoading}
            error={props.previewDataError}
          />
        </section>
      </Panes.Element>
      <Panes.Element id="permissions" title="Access" icon="ti ti-lock">
        <section class="flex h-full min-h-0 flex-col overflow-y-auto p-3">
          <Show
            when={props.template}
            fallback={<div class="p-3 text-sm text-dimmed">Save the template before configuring document access.</div>}
          >
            {(savedTemplate) => (
              <Show when={!props.accessLoading()} fallback={<div class="p-3 text-sm text-dimmed">Loading access…</div>}>
                <ScopedPermissionEditor
                  scope={{ type: "documentTemplate", id: savedTemplate().id }}
                  initialEntries={props.accessEntries()}
                  allowedLevels={[
                    { level: "read", label: "Read", icon: "ti ti-eye" },
                    { level: "write", label: "Write", icon: "ti ti-pencil" },
                    { level: "admin", label: "Admin", icon: "ti ti-shield" },
                  ]}
                />
              </Show>
            )}
          </Show>
        </section>
      </Panes.Element>
    </Panes.Root>
  );
}
