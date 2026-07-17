import { Layout } from "@valentinkolb/cloud/ssr/islands";
import GridsLayoutHelp from "./GridsLayoutHelp";

export const GRIDS_HELP_TOPIC_IDS = [
  "grids-overview",
  "grids-core-model",
  "grids-build-base",
  "grids-tables-fields",
  "grids-views-reports",
  "grids-gql",
  "grids-formulas",
  "grids-forms-dashboards",
  "grids-documents-pdfs",
  "grids-workflows",
  "grids-permissions",
  "grids-operations-troubleshooting",
] as const;

export type GridsHelpTopicId = (typeof GRIDS_HELP_TOPIC_IDS)[number];

export const normalizeGridsHelpTopic = (value: string | null | undefined): GridsHelpTopicId | undefined =>
  GRIDS_HELP_TOPIC_IDS.includes(value as GridsHelpTopicId) ? (value as GridsHelpTopicId) : undefined;

/**
 * Full-page Help uses the exact same registered content as the in-app Help.
 * Grids keeps its established reference copy intact while sharing one shell,
 * navigation model, and window/full-page presentation.
 */
export default function GridsHelpPage(props: { initialTopic?: GridsHelpTopicId }) {
  return (
    <>
      <GridsLayoutHelp />
      <Layout.HelpPage documents={[]} initialTopic={props.initialTopic} />
    </>
  );
}
