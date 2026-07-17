import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type OAuthLayoutHelpProps = {
  documents: readonly HelpDocumentManifest[];
};

export default function OAuthLayoutHelp(props: OAuthLayoutHelpProps) {
  return <Layout.HelpDocuments documents={props.documents} />;
}
