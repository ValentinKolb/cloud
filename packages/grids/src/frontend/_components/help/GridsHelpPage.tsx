import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { type GridsHelpTopicId, gridsHelpTopicHref } from "./grids-help-routing";

/**
 * Full-page Help uses the same Markdown manifest as the in-app Help.
 */
export default function GridsHelpPage(props: { documents: readonly HelpDocumentManifest[]; initialTopic?: GridsHelpTopicId }) {
  return <Layout.HelpPage documents={props.documents} initialTopic={props.initialTopic} topicHref={gridsHelpTopicHref} />;
}
