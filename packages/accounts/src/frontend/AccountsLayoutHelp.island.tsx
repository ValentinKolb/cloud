import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type Props = {
  documents: readonly HelpDocumentManifest[];
  initialTopic?: string;
  mode?: "register" | "page";
};

const HELP_PAGE_BASE = "/app/accounts/help";

export default function AccountsLayoutHelp(props: Props) {
  return props.mode === "page" ? (
    <Layout.HelpPage documents={props.documents} initialTopic={props.initialTopic} pageBase={HELP_PAGE_BASE} />
  ) : (
    <Layout.HelpDocuments documents={props.documents} pageBase={HELP_PAGE_BASE} />
  );
}
