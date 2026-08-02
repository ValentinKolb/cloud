import { installAppWorkspaceController, serializeAppWorkspaceLayoutState } from "@k2b/ui";
import { onCleanup, onMount } from "solid-js";
import { appWorkspaceCookieName, readAppWorkspaceLayoutCookie } from "../_internal/app-workspace-state";

const writeLayoutCookie = (appId: string | null | undefined, state: Parameters<typeof serializeAppWorkspaceLayoutState>[0]) => {
  if (!appId) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${appWorkspaceCookieName(appId)}=${serializeAppWorkspaceLayoutState(state)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
};

export default function AppWorkspaceController(props: { appId?: string | null }) {
  let dispose = () => {};
  onMount(() => {
    dispose = installAppWorkspaceController({
      readState: () => readAppWorkspaceLayoutCookie(document.cookie, props.appId),
      writeState: (state) => writeLayoutCookie(props.appId, state),
    });
  });
  onCleanup(() => dispose());
  return null;
}
