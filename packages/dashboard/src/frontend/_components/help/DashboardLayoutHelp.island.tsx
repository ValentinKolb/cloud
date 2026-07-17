import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type DashboardLayoutHelpProps = {
  documents: readonly HelpDocumentManifest[];
};

export default function DashboardLayoutHelp(props: DashboardLayoutHelpProps) {
  return <Layout.HelpDocuments documents={props.documents} />;
}
