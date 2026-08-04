import { replaceTextareaRange } from "../editor-dom";
import { type Completion, type QueryContext, type SuggestContext, type Suggestion, suggestSync, TRIGGER_CHARS, WORD_CHAR } from "./engine";

type LastExpansion = {
  textarea: HTMLTextAreaElement;
  startOffset: number;
  originalWord: string;
  triggerChar: string;
  expansion: string;
};

const findExpansion = (word: string, completions: readonly Completion[], context: SuggestContext): Suggestion | null => {
  for (const completion of completions) {
    if (completion.trigger !== undefined) continue;
    const suggestions = suggestSync(completion, word, context);
    if (!suggestions) continue;
    const exact = suggestions.find((suggestion) => suggestion.text === word && suggestion.expansion && suggestion.expansion !== word);
    if (exact) return exact;
    const normalized = word.toLowerCase();
    const insensitive = suggestions.find(
      (suggestion) => suggestion.text.toLowerCase() === normalized && suggestion.expansion && suggestion.expansion !== word,
    );
    if (insensitive) return insensitive;
  }
  return null;
};

export type TryExpandOptions = {
  isExcluded?: (text: string, position: number) => boolean;
};

/** Keeps abbreviation restoration isolated to one editor instance. */
export const createCompletionBehaviorState = () => {
  let lastExpansion: LastExpansion | null = null;
  let suppressNextExpansion = false;

  const reset = (): void => {
    lastExpansion = null;
    suppressNextExpansion = false;
  };

  const tryExpand = (
    textarea: HTMLTextAreaElement,
    completions: readonly Completion[] | undefined,
    options: TryExpandOptions = {},
  ): boolean => {
    if (suppressNextExpansion) {
      suppressNextExpansion = false;
      return false;
    }
    if (!completions || completions.length === 0) return false;

    const value = textarea.value;
    const caret = textarea.selectionStart;
    if (caret === 0 || caret !== textarea.selectionEnd) return false;
    const triggerChar = value[caret - 1];
    if (!triggerChar || !TRIGGER_CHARS.has(triggerChar)) return false;

    const wordEnd = caret - 1;
    let wordStart = wordEnd;
    while (wordStart > 0 && WORD_CHAR.test(value[wordStart - 1]!)) wordStart--;
    if (wordStart === wordEnd || options.isExcluded?.(value, wordStart)) return false;

    const originalWord = value.slice(wordStart, wordEnd);
    const suggestion = findExpansion(originalWord, completions, {
      fullText: value,
      caret,
      tokenStart: wordStart,
    });
    if (!suggestion?.expansion || suggestion.expansion === originalWord) return false;
    if (!replaceTextareaRange(textarea, wordStart, caret, suggestion.expansion + triggerChar)) return false;

    lastExpansion = {
      textarea,
      startOffset: wordStart,
      originalWord,
      triggerChar,
      expansion: suggestion.expansion,
    };
    suppressNextExpansion = true;
    return true;
  };

  const tryRestore = (textarea: HTMLTextAreaElement): boolean => {
    const last = lastExpansion;
    if (!last || last.textarea !== textarea) return false;
    const tail = last.startOffset + last.expansion.length + last.triggerChar.length;
    if (
      textarea.selectionStart !== tail ||
      textarea.selectionEnd !== tail ||
      textarea.value.slice(last.startOffset, tail) !== last.expansion + last.triggerChar
    ) {
      return false;
    }
    if (!replaceTextareaRange(textarea, last.startOffset, tail, last.originalWord + last.triggerChar)) return false;

    suppressNextExpansion = true;
    lastExpansion = null;
    return true;
  };

  const applySuggestion = (
    textarea: HTMLTextAreaElement,
    context: QueryContext,
    suggestion: Suggestion,
    options: { trackExpansion?: boolean } = {},
  ): boolean => {
    if (suggestion.textEdit) {
      const { start, end, text } = suggestion.textEdit;
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < start ||
        end > textarea.value.length ||
        textarea.value.slice(start, end) === text
      ) {
        return false;
      }
      return replaceTextareaRange(textarea, start, end, text);
    }

    const baseText = suggestion.expansion ?? suggestion.text;
    if (baseText === context.text) return false;
    const nextChar = textarea.value[context.end];
    const alreadySeparated = nextChar === " " || nextChar === "\t";
    const opensScope = /[([{]$/.test(baseText);
    const appendSpace = suggestion.appendSpace ?? true;
    const insertText = alreadySeparated || opensScope || !appendSpace ? baseText : `${baseText} `;
    if (!replaceTextareaRange(textarea, context.start, context.end, insertText)) return false;

    if ((options.trackExpansion ?? true) && suggestion.expansion !== undefined && suggestion.expansion !== suggestion.text) {
      lastExpansion = {
        textarea,
        startOffset: context.start,
        originalWord: suggestion.text,
        triggerChar: alreadySeparated || opensScope || !appendSpace ? "" : " ",
        expansion: suggestion.expansion,
      };
      suppressNextExpansion = true;
    }
    return true;
  };

  return { applySuggestion, reset, tryExpand, tryRestore };
};
