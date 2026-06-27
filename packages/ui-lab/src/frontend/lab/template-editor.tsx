import { renderLiquidTemplate } from "@valentinkolb/cloud/shared";
import {
  createTemplateEditorPanesValue,
  Panes,
  TemplateEditor,
  TemplatePreview,
  TemplateSampleData,
  type TemplateVariable,
} from "@valentinkolb/cloud/ui";
import { createMemo, createSignal } from "solid-js";
import DemoCard from "./DemoCard";

const FROM_CLOUD_UI = "@valentinkolb/cloud/ui";

const DEFAULT_TEMPLATE = [
  "<p>Hello {{EMAIL}},</p>",
  "",
  "<p>Welcome to {{APP_NAME}}. Your workspace is ready.</p>",
  "",
  "{% if CONTACT_EMAIL != blank %}",
  '<p>Questions? <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a></p>',
  "{% endif %}",
].join("\n");

const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { name: "APP_NAME", kind: "string" },
  { name: "EMAIL", kind: "email" },
  { name: "CONTACT_EMAIL", kind: "email" },
  { name: "LOGIN_URL", kind: "url" },
];

const createSampleData = (): Record<string, string> => ({
  APP_NAME: "Cloud",
  CONTACT_EMAIL: "support@example.org",
  EMAIL: "email@example.com",
  LOGIN_URL: "https://cloud.example.org/auth/login",
});

const buildPreviewSrcdoc = (content: string): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body {
        margin: 0;
        padding: 24px;
        background: #fff;
        color: #18181b;
        font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      a { color: #2563eb; }
      p { margin: 0 0 12px; }
    </style>
  </head>
  <body>${content}</body>
</html>`;

const renderTemplatePreview = (template: string, sampleData: Record<string, string>): string => {
  try {
    return buildPreviewSrcdoc(renderLiquidTemplate(template, sampleData));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Template preview failed";
    return buildPreviewSrcdoc(`<p style="color:#b91c1c;">${message}</p>`);
  }
};

export const TemplateEditorDemo = () => {
  const [value, setValue] = createSignal(DEFAULT_TEMPLATE);
  const [sampleData, setSampleData] = createSignal<Record<string, string>>(createSampleData());
  const [panes, setPanes] = createSignal(createTemplateEditorPanesValue());
  const preview = createMemo(() => renderTemplatePreview(value(), sampleData()));
  const setSampleValue = (name: string, nextValue: string) => {
    setSampleData((current) => ({ ...current, [name]: nextValue }));
  };

  return (
    <DemoCard
      id="template-editor"
      chip={{ kind: "component", name: "TemplateEditor", from: FROM_CLOUD_UI }}
      variant="Core component + panes"
      description="Core email template editor with HTML/Liquid highlighting, completions, preview, and editable sample data."
      code={`<Panes.Root value={panes()} onChange={setPanes} allowResize={false}>
  <Panes.Element id="html" title="HTML" icon="ti ti-code">
    <TemplateEditor value={template} onInput={setTemplate} variables={variables} fill />
  </Panes.Element>
  <Panes.Element id="preview" title="Preview" icon="ti ti-eye">
    <TemplatePreview html={previewHtml} />
  </Panes.Element>
  <Panes.Element id="sample-data" title="Sample data" icon="ti ti-database">
    <TemplateSampleData variables={variables} values={sampleData} onChange={setSampleValue} />
  </Panes.Element>
</Panes.Root>`}
    >
      <div class="flex flex-col gap-3">
        <p class="text-xs text-dimmed">
          Type {"{{"} for values, {"{%"} for Liquid logic, or {"<"} for HTML snippets. Use sample data to change preview values.
        </p>
        <div class="h-[46rem] min-w-0 overflow-hidden rounded-lg bg-zinc-100 p-2 dark:bg-zinc-900">
          <Panes.Root value={panes()} onChange={setPanes} class="h-full w-full" allowResize={false}>
            <Panes.Element id="html" title="HTML" icon="ti ti-code">
              <div class="h-full min-h-0 overflow-auto">
                <TemplateEditor value={value} onInput={setValue} variables={TEMPLATE_VARIABLES} fill />
              </div>
            </Panes.Element>
            <Panes.Element id="preview" title="Preview" icon="ti ti-eye">
              <TemplatePreview html={preview} />
            </Panes.Element>
            <Panes.Element id="sample-data" title="Sample data" icon="ti ti-database">
              <TemplateSampleData variables={TEMPLATE_VARIABLES} values={sampleData} onChange={setSampleValue} />
            </Panes.Element>
          </Panes.Root>
        </div>
      </div>
    </DemoCard>
  );
};
