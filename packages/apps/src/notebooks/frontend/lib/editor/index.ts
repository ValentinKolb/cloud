import { basicExtensions } from "./basic";
import { markdownExtension } from "./markdown";
import { searchTheme } from "./search-theme";
import { tablesExtension } from "./tables";
import { katexExtension } from "./katex";
import { mermaidExtension } from "./mermaid";
import { imageExtension } from "./images";
import { listsExtension } from "./lists";
import { infoBlocksExtension } from "./info-blocks";
import { linksExtension } from "./links";
import { markupExtension } from "./markup";
import { customLightInit, customDarkInit, rawLightInit, rawDarkInit } from "./theme";

export {
  basicExtensions,
  markdownExtension,
  searchTheme,
  tablesExtension,
  katexExtension,
  mermaidExtension,
  imageExtension,
  listsExtension,
  infoBlocksExtension,
  linksExtension,
  markupExtension,
  customLightInit,
  customDarkInit,
  rawLightInit,
  rawDarkInit,
};

export const editor = {
  basicExtensions,
  markdownExtension,
  searchTheme,
  tablesExtension,
  katexExtension,
  mermaidExtension,
  imageExtension,
  listsExtension,
  infoBlocksExtension,
  linksExtension,
  markupExtension,
  customLightInit,
  customDarkInit,
  rawLightInit,
  rawDarkInit,
} as const;
