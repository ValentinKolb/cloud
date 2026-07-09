import { clauseSuggestions, rewriteSameLineClauseItems, sameLineClauseSegment } from "./intelligence-clauses";
import {
  activeSegmentRangeBeforeCaret,
  type CompletionRequest,
  clauseKind,
  isInsideSingleQuotedString,
  tokenRangeAt,
} from "./intelligence-core";
import { completedFromSource } from "./intelligence-source";

export const buildDslQueryIntelligence = ({ query, caret, ctx, currentSource }: CompletionRequest) => {
  const safeCaret = Math.max(0, Math.min(caret, query.length));
  const range = tokenRangeAt(query, safeCaret);
  const active = activeSegmentRangeBeforeCaret(query, safeCaret);
  const segment = active.text;
  if (isInsideSingleQuotedString(segment)) return [];

  const completed = completedFromSource(ctx, segment);
  const sameLine = completed ? sameLineClauseSegment(segment, active.start, completed) : null;
  if (sameLine) {
    const items = clauseSuggestions(clauseKind(sameLine.segment), ctx, query, range, sameLine.segment, currentSource);
    return rewriteSameLineClauseItems(query, items, sameLine.absoluteStart);
  }

  return clauseSuggestions(clauseKind(segment), ctx, query, range, segment, currentSource);
};
