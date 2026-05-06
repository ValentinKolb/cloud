/**
 * Task-progress extraction for the detail-panel "Tasks" section.
 *
 * Counts GFM task-list items in a markdown body — both completed
 * (`- [x]`) and pending (`- [ ]`) — across any bullet marker (`-`, `*`,
 * `+`) and any indentation level (nested tasks count too).
 */

export type TaskProgress = {
  done: number;
  total: number;
};

const TASK_LINE_REGEX = /^[ \t]*[-*+]\s+\[([ xX])\]/gm;

export const extractTaskProgress = (md: string | null): TaskProgress => {
  if (!md) return { done: 0, total: 0 };
  let done = 0;
  let total = 0;
  for (const match of md.matchAll(TASK_LINE_REGEX)) {
    total++;
    const marker = match[1];
    if (marker === "x" || marker === "X") done++;
  }
  return { done, total };
};
