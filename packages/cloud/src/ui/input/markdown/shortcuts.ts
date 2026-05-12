/**
 * Keyboard-shortcut dispatcher for the markdown editor.
 *
 * Maps Cmd/Ctrl + key combos to action functions. Returns `true` if the
 * shortcut was recognised AND executed (caller should `preventDefault`
 * and stop further keydown processing). Returns `false` otherwise so
 * the host can fall back to its own keydown logic.
 *
 * Lesson from overtype issue #80: a misrouted action map made
 * shortcuts silently fail. We keep the dispatch table inline here and
 * call the action functions directly — no indirection through string
 * action IDs.
 */
import { toggleBold, toggleItalic, toggleCode, toggleBulletList, toggleNumberedList, toggleHeading, insertLink } from "./actions";

const isMac = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

export const handleShortcut = (e: KeyboardEvent, ta: HTMLTextAreaElement): boolean => {
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  if (!mod) return false;

  // Plain Cmd/Ctrl + letter (no shift)
  if (!e.shiftKey) {
    switch (e.key.toLowerCase()) {
      case "b":
        toggleBold(ta);
        return true;
      case "i":
        toggleItalic(ta);
        return true;
      case "e":
        // Cmd+E is the de-facto inline-code shortcut on GitHub / Slack.
        toggleCode(ta);
        return true;
      case "k":
        insertLink(ta);
        return true;
    }
  }

  // Cmd/Ctrl + Shift + …
  if (e.shiftKey) {
    switch (e.key) {
      // Headings — pick the digit; Shift+1/2/3 gives `!@#` on US layout.
      // Use the digit on the key itself by reading `e.code` which is
      // layout-independent for the digit row.
      case "!":
      case "1":
        if (e.code === "Digit1") {
          toggleHeading(ta, 1);
          return true;
        }
        break;
      case "@":
      case "2":
        if (e.code === "Digit2") {
          toggleHeading(ta, 2);
          return true;
        }
        break;
      case "#":
      case "3":
        if (e.code === "Digit3") {
          toggleHeading(ta, 3);
          return true;
        }
        break;
      // Lists — overtype convention: Shift+7 = ordered, Shift+8 = bullet.
      // `&` / `*` are the shifted glyphs on US layout.
      case "&":
      case "7":
        if (e.code === "Digit7") {
          toggleNumberedList(ta);
          return true;
        }
        break;
      case "*":
      case "8":
        if (e.code === "Digit8") {
          toggleBulletList(ta);
          return true;
        }
        break;
    }
  }

  return false;
};
