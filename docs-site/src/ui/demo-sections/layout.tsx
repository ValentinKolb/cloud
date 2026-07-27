import {
  AppOverviewDemo,
  AppWorkspaceDemo,
  DockWorkspaceDemo,
  EntitySearchDemo,
  FloatingWindowDemo,
  NavigationEnhancementDemo,
  PaginationDemo,
  PanelDialogDemo,
  PanesDemo,
  PanesProgrammaticTabsDemo,
  PermissionEditorDemo,
  ResourceApiKeysDemo,
  SettingsHelpersDemo,
  SettingsModalDemo,
} from "../../../../packages/ui-lab/src/frontend/lab/navigation";
import { DemoGrid, type DemoSection } from "./types";

const demos: DemoSection = {
  workspace: () => (
    <DemoGrid columns="one">
      <AppWorkspaceDemo />
    </DemoGrid>
  ),
  panes: () => (
    <DemoGrid columns="one">
      <PanesDemo />
      <PanesProgrammaticTabsDemo />
    </DemoGrid>
  ),
  "dock-workspace": (props) => (
    <DemoGrid columns="one">
      <DockWorkspaceDemo initialState={props.dockWorkspaceInitialState} />
    </DemoGrid>
  ),
  overview: () => (
    <DemoGrid columns="one">
      <AppOverviewDemo />
    </DemoGrid>
  ),
  "settings-modal": () => (
    <DemoGrid columns="one">
      <SettingsModalDemo />
      <SettingsHelpersDemo />
    </DemoGrid>
  ),
  "panel-dialog": () => (
    <DemoGrid columns="one">
      <PanelDialogDemo />
    </DemoGrid>
  ),
  "floating-window": () => (
    <DemoGrid columns="one">
      <FloatingWindowDemo />
    </DemoGrid>
  ),
  permissions: () => (
    <DemoGrid columns="one">
      <PermissionEditorDemo />
      <EntitySearchDemo />
      <ResourceApiKeysDemo />
    </DemoGrid>
  ),
  navigation: () => (
    <DemoGrid>
      <NavigationEnhancementDemo />
    </DemoGrid>
  ),
  pagination: () => (
    <DemoGrid>
      <PaginationDemo />
    </DemoGrid>
  ),
};

export default demos;
