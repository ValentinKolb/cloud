import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type WeatherLayoutHelpProps = {
  documents: readonly HelpDocumentManifest[];
};

export default function WeatherLayoutHelp(props: WeatherLayoutHelpProps) {
  return <Layout.HelpDocuments documents={props.documents} />;
}
