import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

type WeatherLayoutHelpProps = {
  documents: readonly HelpDocumentManifest[];
  initialTopic?: string;
  mode?: "register" | "page";
};

export const WEATHER_HELP_PAGE_BASE = "/app/weather/help";

export default function WeatherLayoutHelp(props: WeatherLayoutHelpProps) {
  return props.mode === "page" ? (
    <Layout.HelpPage documents={props.documents} initialTopic={props.initialTopic} pageBase={WEATHER_HELP_PAGE_BASE} />
  ) : (
    <Layout.HelpDocuments documents={props.documents} pageBase={WEATHER_HELP_PAGE_BASE} />
  );
}
