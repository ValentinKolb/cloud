import { Layout } from "@valentinkolb/cloud/ssr/islands";
import GridsLayoutHelp from "./GridsLayoutHelp";
import type { GridsHelpTopicId } from "./grids-help-routing";

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
