import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type FaqLayoutHelpProps = {
  documents: readonly HelpDocumentManifest[];
};

export default function FaqLayoutHelp(props: FaqLayoutHelpProps) {
  return <Layout.HelpDocuments documents={props.documents} />;
}
