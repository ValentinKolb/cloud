import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type ToolsLayoutHelpProps = {
  documents: readonly HelpDocumentManifest[];
  initialTopic?: string;
  mode?: "register" | "page";
};

export const TOOLS_HELP_PAGE_BASE = "/tools/help";

export default function ToolsLayoutHelp(props: ToolsLayoutHelpProps) {
  return props.mode === "page" ? (
    <Layout.HelpPage documents={props.documents} initialTopic={props.initialTopic} pageBase={TOOLS_HELP_PAGE_BASE} />
  ) : (
    <Layout.HelpDocuments documents={props.documents} pageBase={TOOLS_HELP_PAGE_BASE} />
  );
}
