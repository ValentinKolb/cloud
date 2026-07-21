import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type Props = {
  documents: readonly HelpDocumentManifest[];
  initialTopic?: string;
};

export default function ApiDocsHelpPage(props: Props) {
  return <Layout.HelpPage documents={props.documents} initialTopic={props.initialTopic} pageBase="/app/api-docs/help" />;
}
