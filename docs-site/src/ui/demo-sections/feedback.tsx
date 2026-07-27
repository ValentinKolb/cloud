import {
  BadgesDemo,
  ChipsDemo,
  DialogHeaderDemo,
  InfoBlocks,
  PromptAlertDemo,
  PromptBareModalDemo,
  PromptConfirmDemo,
  PromptCustomDialogDemo,
  PromptErrorDemo,
  PromptFormDemo,
  PromptSearchDemo,
  PromptSizesDemo,
  PromptWorkflowFormDemo,
  SpotlightSearchDemo,
  StatusDotsDemo,
  TagsDemo,
  ToastDemo,
  TooltipDemo,
} from "../../../../packages/ui-lab/src/frontend/lab/feedback";
import { DemoGrid, type DemoSection } from "./types";

const demos: DemoSection = {
  blocks: () => (
    <DemoGrid columns="one">
      <InfoBlocks />
    </DemoGrid>
  ),
  badges: () => (
    <DemoGrid>
      <BadgesDemo />
      <ChipsDemo />
      <TagsDemo />
      <StatusDotsDemo />
    </DemoGrid>
  ),
  toast: () => (
    <DemoGrid>
      <ToastDemo />
    </DemoGrid>
  ),
  tooltip: () => (
    <DemoGrid columns="one">
      <TooltipDemo />
    </DemoGrid>
  ),
  prompts: () => (
    <DemoGrid>
      <PromptAlertDemo />
      <PromptErrorDemo />
      <PromptConfirmDemo />
      <SpotlightSearchDemo />
      <PromptSearchDemo />
      <PromptFormDemo />
      <PromptWorkflowFormDemo />
      <PromptCustomDialogDemo />
      <PromptSizesDemo />
      <PromptBareModalDemo />
      <DialogHeaderDemo />
    </DemoGrid>
  ),
};

export default demos;
