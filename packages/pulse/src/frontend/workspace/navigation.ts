import { navigate, navigateTo } from "@valentinkolb/ssr/nav";
import { buildPulseWorkspaceHref, type WorkspaceHrefOptions } from "./routes";

export const navigatePulseWorkspace = (options: WorkspaceHrefOptions): void => {
  const href = buildPulseWorkspaceHref(options);
  if (typeof window !== "undefined" && href === `${window.location.pathname}${window.location.search}`) return;
  navigateTo(href);
};

export const replacePulseWorkspaceUrl = (options: WorkspaceHrefOptions): void => {
  const href = buildPulseWorkspaceHref(options);
  if (typeof window !== "undefined" && href === `${window.location.pathname}${window.location.search}`) return;
  navigate(href, { replace: true, scroll: "preserve", viewTransition: false });
};
