import type { MarkupElement } from "./types";

export type MarkupHistoryState = {
  markup: MarkupElement[];
  markupUndo: MarkupElement[][];
  markupRedo: MarkupElement[][];
};

const MARKUP_HISTORY_LIMIT = 50;

export const commitMarkupHistory = (
  state: MarkupHistoryState,
  markup: MarkupElement[],
  limit = MARKUP_HISTORY_LIMIT,
): MarkupHistoryState => {
  if (markup === state.markup) return state;
  return {
    markup,
    markupUndo: [...state.markupUndo, state.markup].slice(-limit),
    markupRedo: [],
  };
};

export const undoMarkupHistory = (state: MarkupHistoryState, limit = MARKUP_HISTORY_LIMIT): MarkupHistoryState => {
  const previous = state.markupUndo.at(-1);
  if (!previous) return state;
  return {
    markup: previous,
    markupUndo: state.markupUndo.slice(0, -1),
    markupRedo: [state.markup, ...state.markupRedo].slice(0, limit),
  };
};

export const redoMarkupHistory = (state: MarkupHistoryState, limit = MARKUP_HISTORY_LIMIT): MarkupHistoryState => {
  const next = state.markupRedo[0];
  if (!next) return state;
  return {
    markup: next,
    markupUndo: [...state.markupUndo, state.markup].slice(-limit),
    markupRedo: state.markupRedo.slice(1),
  };
};
