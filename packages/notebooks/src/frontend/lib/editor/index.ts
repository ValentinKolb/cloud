import { basicExtensions } from "./basic";
import { codeFontExtension } from "./code-font";
import { imageExtension } from "./images";
import { infoBlocksExtension } from "./info-blocks";
import { katexExtension } from "./katex";
import { linksExtension } from "./links";
import { listsExtension } from "./lists";
import { markExtension } from "./mark";
import { markdownExtension } from "./markdown";
import { markupExtension } from "./markup";
import { mermaidExtension } from "./mermaid";
import { searchTheme } from "./search-theme";
import { subSupExtension } from "./sub-sup";
import { tablesExtension } from "./tables";
import { customDarkInit, customLightInit, rawDarkInit, rawLightInit } from "./theme";

export {
  basicExtensions,
  codeFontExtension,
  imageExtension,
  infoBlocksExtension,
  katexExtension,
  linksExtension,
  listsExtension,
  markExtension,
  markdownExtension,
  markupExtension,
  mermaidExtension,
  searchTheme,
  subSupExtension,
  tablesExtension,
  customDarkInit,
  customLightInit,
  rawDarkInit,
  rawLightInit,
};

export const editor = {
  basicExtensions,
  codeFontExtension,
  imageExtension,
  infoBlocksExtension,
  katexExtension,
  linksExtension,
  listsExtension,
  markExtension,
  markdownExtension,
  markupExtension,
  mermaidExtension,
  searchTheme,
  subSupExtension,
  tablesExtension,
  customDarkInit,
  customLightInit,
  rawDarkInit,
  rawLightInit,
} as const;
