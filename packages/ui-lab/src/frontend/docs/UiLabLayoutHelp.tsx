import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

export const UI_LAB_HELP_PAGE_BASE = "/app/ui-lab/help";

export default function UiLabLayoutHelp(props: { documents: readonly HelpDocumentManifest[] }) {
  return <Layout.HelpDocuments documents={props.documents} pageBase={UI_LAB_HELP_PAGE_BASE} />;
}
