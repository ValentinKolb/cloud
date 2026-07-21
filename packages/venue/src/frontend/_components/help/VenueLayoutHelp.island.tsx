import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type Props = {
  documents: readonly HelpDocumentManifest[];
  initialTopic?: string;
  mode?: "register" | "page";
};

export const VENUE_HELP_PAGE_BASE = "/app/venue/help";

export default function VenueLayoutHelp(props: Props) {
  return props.mode === "page" ? (
    <Layout.HelpPage documents={props.documents} initialTopic={props.initialTopic} pageBase={VENUE_HELP_PAGE_BASE} />
  ) : (
    <Layout.HelpDocuments documents={props.documents} pageBase={VENUE_HELP_PAGE_BASE} />
  );
}
