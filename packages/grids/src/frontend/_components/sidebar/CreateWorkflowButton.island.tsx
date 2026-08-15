import { navigateTo } from "@k2b/ssr/nav";
import { AppWorkspace, dialogCore, panelDialogWorkspaceOptions } from "@k2b/ui";
import type { PublicTable as Table } from "../../../api/public-dto";
import { WorkflowEditor } from "../workflows/WorkflowEditor";

export default function CreateWorkflowButton(props: { baseId: string; tables: Table[] }) {
  const openEditor = async () => {
    await dialogCore.open<void>(
      (close) => (
        <WorkflowEditor
          baseId={props.baseId}
          tables={props.tables}
          onChanged={(workflow) => {
            if (workflow) navigateTo(`/app/grids/${props.baseId}/workflows/${workflow.id}?edit=true`);
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
