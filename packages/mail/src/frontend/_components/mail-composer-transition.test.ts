import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createMailComposerTransition, type MailComposerTransition } from "./mail-composer-transition";

const conflictingTransitions: [MailComposerTransition, MailComposerTransition][] = [
  ["send", "handoff"],
  ["discard", "send"],
  ["attachment", "send"],
  ["calendar", "send"],
  ["recovery", "send"],
];

describe("Mail composer transition", () => {
  test.each(conflictingTransitions)("keeps %s exclusive from %s", (first, second) => {
    createRoot((dispose) => {
      const transition = createMailComposerTransition();
      const reservation = transition.reserve(first);

      expect(reservation).not.toBeNull();
      expect(transition.active()).toBe(first);
      expect(transition.reserve(second)).toBeNull();

      transition.release(reservation!);
      expect(transition.active()).toBeNull();
      dispose();
    });
  });

  test("ignores a stale release", () => {
    createRoot((dispose) => {
      const transition = createMailComposerTransition();
      const first = transition.reserve("attachment")!;
      transition.release(first);
      const second = transition.reserve("send")!;

      transition.release(first);
      expect(transition.active()).toBe("send");
      transition.release(second);
      dispose();
    });
  });
});
