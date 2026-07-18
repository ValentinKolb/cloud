import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

export default function GridsLayoutHelpRegistrar(props: { documents: readonly HelpDocumentManifest[] }) {
  return <Layout.HelpDocuments documents={props.documents} />;
}
