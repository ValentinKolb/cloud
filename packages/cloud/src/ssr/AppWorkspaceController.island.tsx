import { installAppWorkspaceController as installPortableAppWorkspaceController } from "@k2b/ui";
import { onCleanup, onMount } from "solid-js";
import { installAppWorkspaceController as installLegacyAppWorkspaceController } from "../browser/app-workspace-controller";
import { appWorkspaceCookieName, readAppWorkspaceLayoutCookie, serializeAppWorkspaceLayoutState } from "../ui/misc/app-workspace-state";

const writeLayoutCookie = (appId: string | null | undefined, state: Parameters<typeof serializeAppWorkspaceLayoutState>[0]) => {
  if (!appId) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${appWorkspaceCookieName(appId)}=${serializeAppWorkspaceLayoutState(state)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
};

export default function AppWorkspaceController(props: { appId?: string | null }) {
  let dispose = () => {};
  onMount(() => {
    const disposeLegacy = installLegacyAppWorkspaceController({ appId: props.appId });
    const disposePortable = installPortableAppWorkspaceController({
      readState: () => readAppWorkspaceLayoutCookie(document.cookie, props.appId),
      writeState: (state) => writeLayoutCookie(props.appId, state),
    });
    dispose = () => {
      disposePortable();
      disposeLegacy();
    };
  });
  onCleanup(() => dispose());
  return null;
}
