/**
 * Script runtime API exposed to ```script blocks.
 *
 * User-facing globals are deliberately small:
 *   - `std.*` for curated stdlib utilities
 *   - `ui.*` for rendering and prompts
 *   - `nb.*` for notebook-scoped notes, tags, attachments, localKV
 *   - `current.*` for the note that hosts the script, including kv
 *
 * The internal module/file names still use "kit" because the code grew
 * from that prototype. The runtime no longer injects a user-facing
 * `kit` global.
 */
import {
  charts as stdCharts,
  crypto as stdCrypto,
  dates as stdDates,
  encoding as stdEncoding,
  fuzzy as stdFuzzy,
  password as stdPassword,
  text as stdText,
  timing as stdTiming,
} from "@valentinkolb/stdlib";
import { qr as stdQr } from "@valentinkolb/stdlib/qr";
import { clipboard as stdClipboard, files as stdFiles, images as stdImages } from "@valentinkolb/stdlib/browser";
import { createKitAttachmentsAPI } from "./kit-attachments";
import { createKitCurrentNote } from "./kit-note";
import { createKitNotesAPI } from "./kit-notes";
import { createKitLocalStateAPI } from "./kit-localstate";
import { createKitStateAPI } from "./kit-state";
import { createKitTagsAPI } from "./kit-tags";
import { createKitUI } from "./kit-ui";
import type { Kit, KitContext } from "./kit-types";

export type { Kit, KitContext, KitNoteSnapshot, KitMode } from "./kit-types";
// Re-export the common Kit* types so script-side typings can
// reference them without reaching into the internal module.
export type {
  KitCurrentNote,
  KitScriptCurrentNote,
  KitNote,
  KitStdLib,
  KitQuery,
  KitNotesAPI,
  KitNotebookAPI,
  KitReadableNoteBlocks,
  KitWritableNoteBlocks,
  KitTableView,
  KitWritableTableView,
  KitListView,
  KitWritableListView,
  KitTodoItem,
  KitTodoView,
  KitWritableTodoView,
  KitDataView,
  KitWritableDataView,
  KitSectionView,
  KitWritableSectionView,
  KitAttachment,
  KitAttachmentsAPI,
  KitTagSummary,
  KitTagsAPI,
  KitStateAPI,
  KitLocalStateAPI,
  KitToastOptions,
  KitUI,
  KitElement,
  KitChild,
  KitChartKind,
  KitChartOptions,
  KitButtonOptions,
  KitButtonVariant,
  KitHeadingLevel,
} from "./kit-types";

/**
 * Build a fresh `kit` instance for one script run. Each ```script
 * block gets its own kit — sub-modules are recreated per script
 * because they capture `ctx.outputEl` / `ctx.ytext` references that
 * differ per block.
 *
 * Cheap to call — no I/O. The actual API calls happen lazily when
 * the script invokes a method.
 */
export const createKit = (ctx: KitContext): Kit => {
  const current = Object.assign(createKitCurrentNote(ctx), {
    kv: createKitStateAPI(ctx),
  });
  const nb = Object.assign(createKitNotesAPI(ctx), {
    attachments: createKitAttachmentsAPI(ctx),
    tags: createKitTagsAPI(ctx),
    localKV: createKitLocalStateAPI(ctx),
  });
  const ui = createKitUI(ctx);
  const std = {
    text: stdText,
    dates: stdDates,
    fuzzy: stdFuzzy,
    crypto: stdCrypto,
    encoding: stdEncoding,
    charts: stdCharts,
    qr: stdQr,
    password: stdPassword,
    timing: stdTiming,
    files: stdFiles,
    images: stdImages,
    clipboard: { copy: stdClipboard.copy },
  };

  return {
    std,
    ui,
    nb,
    current,
  };
};
