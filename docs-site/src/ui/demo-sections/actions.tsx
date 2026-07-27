import {
  ActionHierarchy,
  AiButtonMarkers,
  ButtonInputs,
  ButtonSizes,
  ButtonsWithIcons,
  ButtonVariants,
  ContextMenuDemo,
  CopyButtonDemo,
  DropdownDemo,
  IconButtons,
  IconButtonsActive,
  RemoveBtnDemo,
  SegmentedControlDemo,
} from "../../../../packages/ui-lab/src/frontend/lab/buttons";
import { DemoGrid, type DemoSection } from "./types";

const demos: DemoSection = {
  buttons: () => (
    <DemoGrid>
      <ButtonSizes />
      <ButtonVariants />
      <ActionHierarchy />
      <AiButtonMarkers />
      <ButtonInputs />
      <IconButtons />
      <IconButtonsActive />
      <ButtonsWithIcons />
    </DemoGrid>
  ),
  "copy-remove": () => (
    <DemoGrid>
      <CopyButtonDemo />
      <RemoveBtnDemo />
    </DemoGrid>
  ),
  menus: () => (
    <DemoGrid>
      <DropdownDemo />
      <ContextMenuDemo />
    </DemoGrid>
  ),
  "segmented-control": () => (
    <DemoGrid>
      <SegmentedControlDemo />
    </DemoGrid>
  ),
};

export default demos;
