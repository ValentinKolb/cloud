import { onCleanup, onMount } from "solid-js";
import { installAppWorkspaceController } from "../browser/app-workspace-controller";

export default function AppWorkspaceController(props: { appId?: string | null }) {
  let dispose = () => {};
  onMount(() => {
    dispose = installAppWorkspaceController({ appId: props.appId });
  });
  onCleanup(() => dispose());
  return null;
}
