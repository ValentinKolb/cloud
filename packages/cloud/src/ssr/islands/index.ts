export { default as SearchBar } from "./SearchBar.island";
import { LayoutHelp } from "../LayoutHelp";

export { LayoutHelp, openLayoutHelpDialog } from "../LayoutHelp";
export type { LayoutHelpProps, LayoutHelpTab } from "../LayoutHelp";

export const Layout = {
  Help: LayoutHelp,
};
