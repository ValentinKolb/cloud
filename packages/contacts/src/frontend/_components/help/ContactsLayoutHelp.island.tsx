import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type Props = {
  documents: readonly HelpDocumentManifest[];
};

export default function ContactsLayoutHelp(props: Props) {
  return <Layout.HelpDocuments documents={props.documents} />;
}
