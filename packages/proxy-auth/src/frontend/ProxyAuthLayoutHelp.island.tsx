import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type ProxyAuthLayoutHelpProps = {
  documents: readonly HelpDocumentManifest[];
};

export default function ProxyAuthLayoutHelp(props: ProxyAuthLayoutHelpProps) {
  return <Layout.HelpDocuments documents={props.documents} />;
}
