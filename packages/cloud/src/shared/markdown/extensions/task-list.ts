/**
 * Task List Extension for Marked
 *
 * Renders task lists with checkboxes:
 * - [ ] Unchecked item
 * - [x] Checked item
 *
 * Also styles regular bullet lists consistently.
 */

import type { MarkedExtension, Tokens, RendererObject, RendererThis } from "marked";

export function taskListExtension(): MarkedExtension {
  const renderer: RendererObject = {
    listitem(this: RendererThis, token: Tokens.ListItem): string {
      // Use parse() for block-level content in list items
      let text = this.parser.parse(token.tokens);
      const isTask = token.task;
      const isChecked = token.checked;

      if (isTask) {
        // Remove any default checkbox that marked might have inserted
        text = text.replace(/<input[^>]*type="checkbox"[^>]*>/gi, "");

        const checkboxHtml = `<input type="checkbox" class="custom-list-task-marker mr-2" ${isChecked ? "checked" : ""} disabled />`;
        const checkedClass = isChecked ? "custom-list-task-checked line-through opacity-70" : "custom-list-task-unchecked";

        return `<li class="custom-list custom-list-task ${checkedClass} flex items-start gap-1">${checkboxHtml}<span>${text}</span></li>\n`;
      }

      return `<li class="custom-list custom-list-bullet">${text}</li>\n`;
    },

    list(this: RendererThis & { listitem: (item: Tokens.ListItem) => string }, token: Tokens.List): string {
      const ordered = token.ordered;
      const start = token.start;
      const body = token.items.map((item: Tokens.ListItem) => this.listitem(item)).join("");

      const tag = ordered ? "ol" : "ul";
      const startAttr = ordered && start !== 1 ? ` start="${start}"` : "";
      const hasTaskItems = token.items.some((item: Tokens.ListItem) => item.task);
      const listClass = ordered
        ? "list-decimal pl-6 my-2 space-y-1"
        : hasTaskItems
          ? "pl-0 my-2 space-y-1 list-none"
          : "pl-4 my-2 space-y-1";

      return `<${tag}${startAttr} class="${listClass}">\n${body}</${tag}>\n`;
    },
  };

  return { renderer };
}
