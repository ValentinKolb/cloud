import { Layout } from "@valentinkolb/cloud/ssr/islands";
import {
  NotebookCoreModelHelp,
  NotebookOperationsHelp,
  NotebookScriptApiHelp,
  NotebookScriptsHelp,
  NotebookSettingsHelp,
  NotebookStartHelp,
  NotebookStructuredBlocksHelp,
  NotebookTableFormulasHelp,
  NotebookWriteOrganizeHelp,
} from "./notebook-help-content";

export default function NotebookLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="notebooks-start"
        title="Start"
        icon="ti ti-notebook"
        description="What Notebooks is for and how notes, structure, and scripts fit together."
        order={100}
      >
        <NotebookStartHelp />
      </Layout.Help>

      <Layout.Help
        id="notebooks-core-model"
        title="Core model"
        icon="ti ti-components"
        description="The stable concepts behind notebooks, notes, named blocks, attachments, and scripts."
        order={110}
      >
        <NotebookCoreModelHelp />
      </Layout.Help>

      <Layout.Help
        id="notebooks-write-organize"
        title="Write & organize"
        icon="ti ti-markdown"
        description="Write readable Markdown notes, connect them with links and tags, and attach files."
        order={120}
      >
        <NotebookWriteOrganizeHelp />
      </Layout.Help>

      <Layout.Help
        id="notebooks-structured-blocks"
        title="Structured blocks"
        icon="ti ti-braces"
        description="Use @ref blocks to make tables, lists, todos, data, and sections script-readable."
        order={130}
      >
        <NotebookStructuredBlocksHelp />
      </Layout.Help>

      <Layout.Help
        id="notebooks-table-formulas"
        title="Table formulas"
        icon="ti ti-math-function"
        description="Complete table formula syntax and function reference."
        order={140}
      >
        <NotebookTableFormulasHelp />
      </Layout.Help>

      <Layout.Help
        id="notebooks-scripts"
        title="Scripts"
        icon="ti ti-code"
        description="Build dashboards, buttons, charts, and small workflows from notebook data."
        order={150}
      >
        <NotebookScriptsHelp />
      </Layout.Help>

      <Layout.Help
        id="notebooks-script-api"
        title="Script API"
        icon="ti ti-api"
        description="Complete reference for current, nb, ui, std, KV, tags, and attachments."
        order={160}
      >
        <NotebookScriptApiHelp />
      </Layout.Help>

      <Layout.Help
        id="notebooks-settings-access"
        title="Settings & access"
        icon="ti ti-settings"
        description="Configure notebook details, permissions, exports, feature flags, and destructive actions."
        order={170}
      >
        <NotebookSettingsHelp />
      </Layout.Help>

      <Layout.Help
        id="notebooks-troubleshooting"
        title="Troubleshooting"
        icon="ti ti-lifebuoy"
        description="Fix common Markdown, @ref, formula, script, attachment, and search problems."
        order={180}
      >
        <NotebookOperationsHelp />
      </Layout.Help>
    </>
  );
}
