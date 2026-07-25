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
import { clipboard as stdClipboard, files as stdFiles, images as stdImages } from "@valentinkolb/stdlib/browser";
import { qr as stdQr } from "@valentinkolb/stdlib/qr";
import { createKitAttachmentsAPI } from "./kit-attachments";
import { createKitLocalStateAPI } from "./kit-localstate";
import { createKitCurrentNote } from "./kit-note";
import { createKitNotesAPI } from "./kit-notes";
import { createKitStateAPI } from "./kit-state";
import { createKitTagsAPI } from "./kit-tags";
import type { Kit, KitContext } from "./kit-types";
import { createKitUI } from "./kit-ui";

// Re-export the common Kit* types so script-side typings can
// reference them without reaching into the internal module.
export type {
  Kit,
  KitAttachment,
  KitAttachmentsAPI,
  KitButtonOptions,
  KitButtonVariant,
  KitChartKind,
  KitChartOptions,
  KitChild,
  KitContext,
  KitCurrentNote,
  KitDataView,
  KitElement,
  KitHeadingLevel,
  KitListView,
  KitLocalStateAPI,
  KitMode,
  KitNote,
  KitNotebookAPI,
  KitNoteSnapshot,
  KitNotesAPI,
  KitQuery,
  KitReadableNoteBlocks,
  KitScriptCurrentNote,
  KitSectionView,
  KitStateAPI,
  KitStdLib,
  KitTableView,
  KitTagSummary,
  KitTagsAPI,
  KitToastOptions,
  KitTodoItem,
  KitTodoView,
  KitUI,
  KitWritableDataView,
  KitWritableListView,
  KitWritableNoteBlocks,
  KitWritableSectionView,
  KitWritableTableView,
  KitWritableTodoView,
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
