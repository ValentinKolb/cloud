import { AiSkillsManagerDemo } from "../../../../packages/ui-lab/src/frontend/lab/ai-skills";
import {
  ChartBar,
  ChartDonut,
  ChartEmpty,
  ChartLine,
  ChartLive,
  ChartSparkline,
  ChartStateTimeline,
  CodeDisplayDemo,
  DataTableAdminPatternDemo,
  DataTableFullDemo,
  DataTableMinimalDemo,
  LightboxDemo,
  LogEntriesTableDemo,
  MarkdownEditorFullDemo,
  MarkdownViewDemo,
  PdfPreviewDemo,
  StructuredDataPreviewDemo,
} from "../../../../packages/ui-lab/src/frontend/lab/content";
import { DocCodeDemo, DocComponentsDemo } from "../../../../packages/ui-lab/src/frontend/lab/docs-components";
import {
  FileBrowserDemo,
  FileBrowserDialogDemo,
  FileBrowserReadOnlyDemo,
} from "../../../../packages/ui-lab/src/frontend/lab/files";
import { TemplateEditorDemo } from "../../../../packages/ui-lab/src/frontend/lab/template-editor";
import { DemoGrid, type DemoSection } from "./types";

const demos: DemoSection = {
  charts: () => (
    <DemoGrid columns="one">
      <ChartLive />
      <ChartLine />
      <ChartStateTimeline />
      <ChartBar />
      <ChartDonut />
      <ChartSparkline />
      <ChartEmpty />
    </DemoGrid>
  ),
  tables: () => (
    <DemoGrid columns="one">
      <DataTableFullDemo />
      <DataTableAdminPatternDemo />
      <DataTableMinimalDemo />
    </DemoGrid>
  ),
  code: () => (
    <DemoGrid columns="one">
      <CodeDisplayDemo />
      <LogEntriesTableDemo />
    </DemoGrid>
  ),
  "structured-data": () => (
    <DemoGrid columns="one">
      <StructuredDataPreviewDemo />
    </DemoGrid>
  ),
  media: () => (
    <DemoGrid>
      <LightboxDemo />
      <PdfPreviewDemo />
    </DemoGrid>
  ),
  files: () => (
    <DemoGrid columns="one">
      <FileBrowserDemo />
      <FileBrowserReadOnlyDemo />
      <FileBrowserDialogDemo />
    </DemoGrid>
  ),
  "ai-skills": () => (
    <DemoGrid columns="one">
      <AiSkillsManagerDemo />
    </DemoGrid>
  ),
  "template-editor": () => (
    <DemoGrid columns="one">
      <TemplateEditorDemo />
    </DemoGrid>
  ),
  docs: () => (
    <DemoGrid columns="one">
      <DocComponentsDemo />
      <DocCodeDemo />
    </DemoGrid>
  ),
  markdown: (props) => (
    <DemoGrid columns="one">
      <MarkdownViewDemo html={props.markdownHtml} />
      <MarkdownEditorFullDemo />
    </DemoGrid>
  ),
};

export default demos;
