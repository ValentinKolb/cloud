import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type ToolsLayoutHelpProps = {
  documents: readonly HelpDocumentManifest[];
};

export default function ToolsLayoutHelp(props: ToolsLayoutHelpProps) {
  return <Layout.HelpDocuments documents={props.documents} />;
}
