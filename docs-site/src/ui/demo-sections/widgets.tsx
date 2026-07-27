import {
  WidgetAdminQueueDemo,
  WidgetHeroDemo,
  WidgetRecentNotesDemo,
  WidgetServiceStatesDemo,
} from "../../../../packages/ui-lab/src/frontend/lab/surfaces-cards";
import { DemoGrid, type DemoSection } from "./types";

const demos: DemoSection = {
  dashboard: () => (
    <DemoGrid columns="one">
      <WidgetAdminQueueDemo />
      <WidgetRecentNotesDemo />
      <WidgetHeroDemo />
      <WidgetServiceStatesDemo />
    </DemoGrid>
  ),
};

export default demos;
