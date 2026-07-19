import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

export default function GridsEmbeddedHelp(props: { documents: readonly HelpDocumentManifest[]; initialTopic?: string }) {
  return <Layout.HelpPage documents={props.documents} initialTopic={props.initialTopic} includeShortcuts={false} embedded />;
}
