import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type NotebookLayoutHelpProps = {
  documents: readonly HelpDocumentManifest[];
  initialTopic?: string;
  mode?: "register" | "page";
};

const HELP_PAGE_BASE = "/app/notebooks/help";

/**
 * Hydrated registry bridge. The server passes metadata only; article bodies
 * remain behind the authenticated Notebooks API.
 */
export default function NotebookLayoutHelp(props: NotebookLayoutHelpProps) {
  return props.mode === "page" ? (
    <Layout.HelpPage documents={props.documents} initialTopic={props.initialTopic} pageBase={HELP_PAGE_BASE} />
  ) : (
    <Layout.HelpDocuments documents={props.documents} pageBase={HELP_PAGE_BASE} />
  );
}
