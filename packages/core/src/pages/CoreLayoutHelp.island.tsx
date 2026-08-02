import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type Props = {
  documents: readonly HelpDocumentManifest[];
  initialTopic?: string;
  pageBase: string;
};

export default function CoreLayoutHelp(props: Props) {
  return <Layout.HelpPage documents={props.documents} initialTopic={props.initialTopic} pageBase={props.pageBase} />;
}
