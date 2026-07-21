import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type ProxyAuthLayoutHelpProps = {
  documents: readonly HelpDocumentManifest[];
  initialTopic?: string;
  mode?: "register" | "page";
};

const HELP_PAGE_BASE = "/admin/proxy-auth/help";

export default function ProxyAuthLayoutHelp(props: ProxyAuthLayoutHelpProps) {
  return props.mode === "page" ? (
    <Layout.HelpPage documents={props.documents} initialTopic={props.initialTopic} pageBase={HELP_PAGE_BASE} />
  ) : (
    <Layout.HelpDocuments documents={props.documents} pageBase={HELP_PAGE_BASE} />
  );
}
