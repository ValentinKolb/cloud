import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { UI_LAB_HELP_PAGE_BASE } from "../docs/UiLabLayoutHelp";

export default function UiLabHelpPage(props: { documents: readonly HelpDocumentManifest[]; initialTopic?: string }) {
  return <Layout.HelpPage documents={props.documents} initialTopic={props.initialTopic} pageBase={UI_LAB_HELP_PAGE_BASE} />;
}
