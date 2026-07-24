import { AppWorkspace, dialogCore, panelDialogWorkspaceOptions } from "@valentinkolb/cloud/ui";
import { EmailTemplateManager } from "../workflows/WorkflowEmailTemplates";

export default function EmailTemplatesButton(props: { baseId: string }) {
  const openManager = async () => {
    await dialogCore.open<void>(
      (close) => <EmailTemplateManager baseId={props.baseId} onChanged={() => undefined} onClose={close} />,
      panelDialogWorkspaceOptions,
    );
  };

  return (
    <AppWorkspace.SidebarItem tone="success" onClick={() => void openManager()}>
      <AppWorkspace.SidebarItemIcon icon="ti ti-mail" />
      <AppWorkspace.SidebarItemLabel>Email templates</AppWorkspace.SidebarItemLabel>
    </AppWorkspace.SidebarItem>
  );
}
