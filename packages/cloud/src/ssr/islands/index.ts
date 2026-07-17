export { default as SearchBar } from "./SearchBar.island";

import { AppLaunchpadButton, AppLaunchpadProvider } from "../AppLaunchpad.island";
import { LayoutHelp, LayoutHelpDocuments } from "../LayoutHelp";

export type { AppLaunchpadApp, AppLaunchpadLegalLink } from "../AppLaunchpad.island";
export { AppLaunchpadButton, AppLaunchpadProvider, openAppLaunchpad, setAppLaunchpadContext } from "../AppLaunchpad.island";
export type { LayoutHelpDocumentsProps, LayoutHelpProps, LayoutHelpTab } from "../LayoutHelp";
export { LayoutHelp, LayoutHelpDocuments, openLayoutHelpDialog } from "../LayoutHelp";

export const Layout = {
  Help: LayoutHelp,
  HelpDocuments: LayoutHelpDocuments,
  AppLaunchpadButton,
  AppLaunchpadProvider,
};
