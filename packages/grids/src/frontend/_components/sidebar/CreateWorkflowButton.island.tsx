import { AppWorkspace, dialogCore, panelDialogWorkspaceOptions } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import type { Table } from "../../../service";
import { WorkflowEditor } from "../workflows/WorkflowEditor";

export default function CreateWorkflowButton(props: { baseId: string; baseShortId: string; tables: Table[] }) {
  const openEditor = async () => {
    await dialogCore.open<void>(
      (close) => (
        <WorkflowEditor
          baseId={props.baseId}
          baseShortId={props.baseShortId}
          tables={props.tables}
          onChanged={(workflow) => {
            if (workflow) navigateTo(`/app/grids/${props.baseShortId}/workflows/${workflow.shortId}?edit=true`);
          }}
          onClose={close}
        />
      ),
      { ...panelDialogWorkspaceOptions, cancelBehavior: "ignore" },
    );
  };

  return (
    <AppWorkspace.SidebarItem tone="success" onClick={() => void openEditor()}>
      <AppWorkspace.SidebarItemIcon icon="ti ti-plus" />
      <AppWorkspace.SidebarItemLabel>New workflow</AppWorkspace.SidebarItemLabel>
    </AppWorkspace.SidebarItem>
  );
}
