import { AppWorkspace, prompts } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { createSignal } from "solid-js";
import SpaceSettingsDialog from "../edit/SpaceSettingsDialog";

type Props = {
  spaceId: string;
  baseUrl: string;
  variant: "sidebar" | "icon";
  viewTransitionName?: string;
};

export default function SpaceSettingsButton(props: Props) {
  const [open, setOpen] = createSignal(false);

  const openDialog = async () => {
    if (open()) return;
    setOpen(true);
    let workspaceChanged = false;
    try {
      await prompts.dialog<void>(
        (close) => (
          <SpaceSettingsDialog
            spaceId={props.spaceId}
            baseUrl={props.baseUrl}
            close={() => close()}
            onWorkspaceChange={() => {
              workspaceChanged = true;
            }}
          />
        ),
        { surface: "bare", header: false, size: "large" },
      );
    } finally {
      setOpen(false);
      if (workspaceChanged) refreshCurrentPath();
    }
  };

  if (props.variant === "icon") {
    return (
      <AppWorkspace.SidebarIconAction
        icon={open() ? "ti ti-loader-2 animate-spin" : "ti ti-settings"}
        label="Space settings"
        disabled={open()}
        viewTransitionName={props.viewTransitionName}
        onClick={() => void openDialog()}
      />
    );
  }

  return (
    <AppWorkspace.SidebarItem
      icon={open() ? "ti ti-loader-2 animate-spin" : "ti ti-settings"}
      disabled={open()}
      viewTransitionName={props.viewTransitionName}
      onClick={() => void openDialog()}
    >
      Space settings
    </AppWorkspace.SidebarItem>
  );
}
