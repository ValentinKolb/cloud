import type { AiConversationTimelineEntry } from "../types";

export type TimelineAnchorPosition = { seq: number; top: number };

export const isTimelineRailScrollable = (entryCount: number, height: number): boolean => entryCount * 16 > height - 16;

export const activeTimelineSeq = (anchors: TimelineAnchorPosition[], viewportTop: number, viewportHeight: number): number | null => {
  if (anchors.length === 0) return null;
  const threshold = viewportTop + Math.min(180, Math.max(72, viewportHeight * 0.28));
  let active = anchors[0]!.seq;
  for (const anchor of anchors) {
    if (anchor.top > threshold) break;
    active = anchor.seq;
  }
  return active;
};

export const adjacentTimelineEntry = (
  entries: readonly AiConversationTimelineEntry[],
  currentSeq: number | null,
  direction: -1 | 1,
): AiConversationTimelineEntry | null => {
  if (entries.length === 0) return null;
  const currentIndex = currentSeq === null ? (direction > 0 ? -1 : entries.length) : entries.findIndex((entry) => entry.seq === currentSeq);
  const fallbackIndex = direction > 0 ? 0 : entries.length - 1;
  const nextIndex = currentIndex < 0 ? fallbackIndex : Math.min(entries.length - 1, Math.max(0, currentIndex + direction));
  return entries[nextIndex] ?? null;
};
