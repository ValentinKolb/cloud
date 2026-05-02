import { detailPanel, type DetailSelectPayload } from "@valentinkolb/stdlib/solid";
import type { GridRecord } from "../../service";

/**
 * Detail-panel selection plumbing for grids records. Mirrors the contacts
 * `_components/context.ts` pattern, but per-record and with a "live | trash"
 * mode flag piggy-backed on the same payload so the detail panel can swap
 * its actions (edit/delete vs. restore) without a full SSR round-trip.
 */

export const RECORD_DETAIL_EVENT = "grids-record-select";

export type RecordDetailMode = "live" | "trash";

export type RecordDetailPayload = DetailSelectPayload<GridRecord> & {
  mode: RecordDetailMode;
};

type TransitionDoc = Document & {
  startViewTransition?: (callback: () => void) => void;
};

const withViewTransition = (callback: () => void) => {
  const doc = document as TransitionDoc;
  if (doc.startViewTransition) {
    doc.startViewTransition(callback);
    return;
  }
  callback();
};

/** Reads the currently selected record id off the URL (`?record=<id>`). */
export const getSelectedRecordIdFromUrl = (): string | null =>
  detailPanel.getUrlParam("record");

/** Dispatches selection updates to listeners (panel + list). */
export const dispatchRecordDetailSelect = (
  record: GridRecord | null,
  recordId: string | null,
  mode: RecordDetailMode,
) => {
  window.dispatchEvent(
    new CustomEvent(RECORD_DETAIL_EVENT, {
      detail: { item: record, itemKey: recordId, mode } as RecordDetailPayload,
    }),
  );
};

/** Updates `?record=<id>` in-place (no navigation) and notifies listeners. */
export const setSelectedRecordInUrl = (config: {
  recordId: string | null;
  record?: GridRecord | null;
  mode?: RecordDetailMode;
}) => {
  withViewTransition(() => {
    detailPanel.setUrlParam("record", config.recordId);
    dispatchRecordDetailSelect(config.record ?? null, config.recordId, config.mode ?? "live");
  });
};

export const clearSelectedRecordInUrl = (mode: RecordDetailMode = "live") => {
  setSelectedRecordInUrl({ recordId: null, record: null, mode });
};
