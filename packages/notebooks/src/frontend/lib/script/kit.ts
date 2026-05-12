/**
 * Kit — the user-facing API surface exposed to ```script blocks.
 *
 * Phase 2: full surface across `kit.note`, `kit.notes`,
 * `kit.attachments`, `kit.tags`, `kit.state`, `kit.localState`,
 * `kit.ui`. Each sub-module lives in its own file (`kit-note.ts`,
 * `kit-notes.ts`, …) — this factory just assembles them.
 *
 * Why "kit" and not the lodash `_`:
 *  - `_` shadowed by the JS throwaway-variable convention
 *  - Stack traces / tooltips read better with a semantic name
 *  - Continuity with the existing `kit` API on the homepage app
 *
 * Hard boundaries enforced by the kit:
 *  - Notebook-scoped — every cross-note query / mutation runs
 *    against `ctx.notebookId`. There is no parameter to reach
 *    other notebooks.
 *  - Edit vs. read mode — `kit.note.set*` / `kit.attachments.insertIntoContent`
 *    throw in read-mode (no Y.Text); `kit.state.*` becomes a no-op.
 *
 * Phase 3+ may add `kit.std` (re-exports from stdlib),
 * `kit.ui.prompt.{form,confirm,...}`, and CodeMirror autocomplete
 * for the `kit.*` paths.
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
import {
  clipboard as stdClipboard,
  files as stdFiles,
  images as stdImages,
} from "@valentinkolb/stdlib/browser";
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
  KitNote,
  KitTask,
  KitQuery,
  KitNotesAPI,
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
export const createKit = (ctx: KitContext): Kit => ({
  // ── App-aware modules — created per kit (capture ctx) ───────────
  note: createKitCurrentNote(ctx),
  notes: createKitNotesAPI(ctx),
  attachments: createKitAttachmentsAPI(ctx),
  tags: createKitTagsAPI(ctx),
  state: createKitStateAPI(ctx),
  localState: createKitLocalStateAPI(ctx),
  ui: createKitUI(ctx),

  // ── Pass-through stdlib namespaces — same reference every run ──
  // No wrapping, no rename: the full stdlib API surface applies.
  // See `KitStdLib` in `kit-types.ts` for the curated subset.
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
  // Single-method facade — the full clipboard module has more, but
  // we keep the kit surface minimal until script authors ask for it.
  clipboard: { copy: stdClipboard.copy },
});
