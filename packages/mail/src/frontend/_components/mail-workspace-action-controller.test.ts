import { describe, expect, test } from "bun:test";
import type { MailActionId } from "./mail-actions";
import type { MailBulkTarget } from "./mail-bulk-actions";
import {
  type MailWorkspaceActionHost,
  mailOptimisticFields,
  removeDestinationPlacements,
  runMailWorkspaceAction,
} from "./mail-workspace-action-controller";

const target = (conversationId: string, sourceFolderIds = ["inbox"]): MailBulkTarget => ({
  conversationId,
  label: conversationId,
  sourceFolderIds,
});

const host = (overrides: Partial<MailWorkspaceActionHost> = {}) => {
  let current: AbortController | null = null;
  const events: string[] = [];
  const value: MailWorkspaceActionHost = {
    canRun: () => true,
    resolveTargets: () => [target("one"), target("two")],
    chooseDestinationFolder: async () => "archive",
    isDisposed: () => false,
    begin: (controller) => {
      current = controller;
      events.push("begin");
    },
    isCurrent: (controller) => current === controller,
    finish: (controller) => {
      if (current === controller) current = null;
      events.push("finish");
    },
    isAbortError: (error) => error instanceof DOMException && error.name === "AbortError",
    applyOptimistic: () => events.push("optimistic"),
    clearOptimistic: (ids) => events.push(`clear:${ids.join(",")}`),
    submit: async ({ target: item }) => {
      events.push(`submit:${item.conversationId}`);
    },
    pruneSelection: (ids) => events.push(`prune:${[...ids].join(",")}`),
    removesActiveConversation: () => false,
    refreshAfterSuccess: async () => {
      events.push("refresh");
    },
    reconcile: async () => {
      events.push("reconcile");
    },
    showMissingTarget: async () => {
      events.push("missing");
    },
    showNothingToMove: () => events.push("nothing"),
    showSuccess: (_action, _targets, succeeded) => events.push(`success:${succeeded}`),
    showFailures: async (failures) => {
      events.push(`failures:${failures.length}`);
    },
    showError: async () => {
      events.push("error");
    },
    ...overrides,
  };
  return { host: value, events };
};

describe("Mail workspace action controller", () => {
  test("owns the successful optimistic action sequence", async () => {
    const fixture = host();
    await runMailWorkspaceAction("mark_read", {}, fixture.host);
    expect(fixture.events).toEqual([
      "begin",
      "optimistic",
      "submit:one",
      "submit:two",
      "clear:",
      "prune:one,two",
      "refresh",
      "success:2",
      "finish",
    ]);
  });

  test("keeps partial failures explicit and reconciles successful targets", async () => {
    const fixture = host({
      submit: async ({ target: item }) => {
        if (item.conversationId === "two") throw new Error("provider rejected");
      },
    });
    await runMailWorkspaceAction("archive", {}, fixture.host);
    expect(fixture.events).toContain("clear:two");
    expect(fixture.events).toContain("prune:one");
    expect(fixture.events).toContain("failures:1");
  });

  test("normalizes move targets and optimistic fields", () => {
    expect(removeDestinationPlacements([target("one", ["inbox", "archive"]), target("two", ["archive"])], "archive")).toEqual([
      target("one", ["inbox"]),
    ]);
    expect(mailOptimisticFields("flag" satisfies MailActionId)).toEqual(["flagged"]);
    expect(mailOptimisticFields("archive")).toEqual([]);
  });
});
