export { default as SearchBar } from "./SearchBar.island";

import { AppLaunchpadButton, AppLaunchpadProvider } from "../AppLaunchpad.island";
import { LayoutHelp, LayoutHelpDocuments, LayoutHelpPage } from "../LayoutHelp";

export type { AppLaunchpadApp, AppLaunchpadLegalLink } from "../AppLaunchpad.island";
export { AppLaunchpadButton, AppLaunchpadProvider, openAppLaunchpad, setAppLaunchpadContext } from "../AppLaunchpad.island";
export type { LayoutHelpDocumentsProps, LayoutHelpPageProps, LayoutHelpProps, LayoutHelpTab } from "../LayoutHelp";
export { LayoutHelp, LayoutHelpDocuments, LayoutHelpPage, openLayoutHelpDialog } from "../LayoutHelp";

export const Layout = {
  Help: LayoutHelp,
  HelpDocuments: LayoutHelpDocuments,
  HelpPage: LayoutHelpPage,
  AppLaunchpadButton,
  AppLaunchpadProvider,
};
