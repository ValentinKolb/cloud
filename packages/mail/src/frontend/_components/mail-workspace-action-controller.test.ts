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

  test("reserves a move before opening its destination picker", async () => {
    let releasePicker!: (value: string | null) => void;
    let busy = false;
    let activeController: AbortController | null = null;
    const fixture = host({
      canRun: () => !busy,
      begin: (controller) => {
        busy = true;
        activeController = controller;
        fixture.events.push("begin");
      },
      isCurrent: (controller) => activeController === controller,
      finish: (controller) => {
        if (activeController !== controller) return;
        busy = false;
        activeController = null;
        fixture.events.push("finish");
      },
      chooseDestinationFolder: () =>
        new Promise<string | null>((resolve) => {
          releasePicker = resolve;
        }),
    });

    const first = runMailWorkspaceAction("move", {}, fixture.host);
    const second = runMailWorkspaceAction("move", {}, fixture.host);
    expect(fixture.events).toEqual(["begin"]);

    releasePicker("archive");
    await Promise.all([first, second]);
    expect(fixture.events.filter((event) => event === "begin")).toHaveLength(1);
    expect(fixture.events.filter((event) => event.startsWith("submit:"))).toEqual(["submit:one", "submit:two"]);
  });

  test("reconciles a partially submitted multi-placement read", async () => {
    let submittedPlacements = 0;
    const fixture = host({
      resolveTargets: () => [target("one", ["primary", "shared"])],
      submit: async ({ sourceFolderId }) => {
        if (sourceFolderId === "shared") throw new Error("provider rejected");
      },
      showFailures: async (failures) => {
        submittedPlacements = failures[0]?.submittedPlacements ?? 0;
        fixture.events.push(`failures:${failures.length}`);
      },
    });

    await runMailWorkspaceAction("mark_read", { silent: true }, fixture.host);
    expect(fixture.events).toContain("clear:one");
    expect(fixture.events).toContain("reconcile");
    expect(fixture.events).toContain("failures:1");
    expect(submittedPlacements).toBe(1);
  });

  test("serializes an explicit unread action behind a pending read", async () => {
    let releaseSubmit!: () => void;
    let busy = false;
    let activeController: AbortController | null = null;
    const submittedActions: MailActionId[] = [];
    const fixture = host({
      resolveTargets: () => [target("one")],
      canRun: () => !busy,
      begin: (controller) => {
        busy = true;
        activeController = controller;
        fixture.events.push("begin");
      },
      isCurrent: (controller) => activeController === controller,
      finish: (controller) => {
        if (activeController !== controller) return;
        busy = false;
        activeController = null;
        fixture.events.push("finish");
      },
      submit: ({ actionId }) =>
        new Promise<void>((resolve) => {
          submittedActions.push(actionId);
          releaseSubmit = resolve;
        }),
    });

    const automaticRead = runMailWorkspaceAction("mark_read", { silent: true }, fixture.host);
    const explicitUnread = runMailWorkspaceAction("mark_unread", {}, fixture.host);
    expect(fixture.events.filter((event) => event === "begin")).toHaveLength(1);

    releaseSubmit();
    await Promise.all([automaticRead, explicitUnread]);
    expect(submittedActions).toEqual(["mark_read"]);
    expect(fixture.events.filter((event) => event === "optimistic")).toHaveLength(1);
  });
});
