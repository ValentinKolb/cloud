export { default as SearchBar } from "./SearchBar.island";
import { LayoutHelp } from "../LayoutHelp";
import { AppLaunchpadButton, AppLaunchpadProvider } from "../AppLaunchpad.island";

export { AppLaunchpadButton, AppLaunchpadProvider, openAppLaunchpad, setAppLaunchpadContext } from "../AppLaunchpad.island";
export type { AppLaunchpadApp, AppLaunchpadLegalLink } from "../AppLaunchpad.island";
export { LayoutHelp, openLayoutHelpDialog } from "../LayoutHelp";
export type { LayoutHelpProps, LayoutHelpTab } from "../LayoutHelp";

export const Layout = {
  Help: LayoutHelp,
  AppLaunchpadButton,
  AppLaunchpadProvider,
};
