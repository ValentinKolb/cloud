import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type NotebookLayoutHelpProps = {
  documents: readonly HelpDocumentManifest[];
};

/**
 * Hydrated registry bridge. The server passes metadata only; article bodies
 * remain behind the authenticated Notebooks API.
 */
export default function NotebookLayoutHelp(props: NotebookLayoutHelpProps) {
  return <Layout.HelpDocuments documents={props.documents} />;
}
