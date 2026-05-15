import { basicExtensions } from "./basic";
import { codeFontExtension } from "./code-font";
import { dataBlocksExtension } from "./data-blocks";
import { imageExtension } from "./images";
import { infoBlocksExtension } from "./info-blocks";
import { katexExtension } from "./katex";
import { linksExtension } from "./links";
import { listsExtension } from "./lists";
import { markExtension } from "./mark";
import { markdownExtension } from "./markdown";
import { markupExtension } from "./markup";
import { mermaidExtension } from "./mermaid";
import { namedBlocksExtension } from "./named-blocks";
import { scriptsExtension } from "./scripts";
import { searchTheme } from "./search-theme";
import { subSupExtension } from "./sub-sup";
import { tablesExtension } from "./tables";
import { tagPillExtension } from "./tag-pill";
import { customDarkInit, customLightInit, rawDarkInit, rawLightInit } from "./theme";
import { initialMarkdownDecorationRefreshExtension } from "./_lib/cursor-zone-field";

export {
  initialMarkdownDecorationRefreshExtension,
  basicExtensions,
  codeFontExtension,
  dataBlocksExtension,
  imageExtension,
  infoBlocksExtension,
  katexExtension,
  linksExtension,
  listsExtension,
  markExtension,
  markdownExtension,
  markupExtension,
  mermaidExtension,
  namedBlocksExtension,
  scriptsExtension,
  searchTheme,
  subSupExtension,
  tablesExtension,
  tagPillExtension,
  customDarkInit,
  customLightInit,
  rawDarkInit,
  rawLightInit,
};

export const editor = {
  initialMarkdownDecorationRefreshExtension,
  basicExtensions,
  codeFontExtension,
  dataBlocksExtension,
  imageExtension,
  infoBlocksExtension,
  katexExtension,
  linksExtension,
  listsExtension,
  markExtension,
  markdownExtension,
  markupExtension,
  mermaidExtension,
  namedBlocksExtension,
  scriptsExtension,
  searchTheme,
  subSupExtension,
  tablesExtension,
  tagPillExtension,
  customDarkInit,
  customLightInit,
  rawDarkInit,
  rawLightInit,
} as const;
