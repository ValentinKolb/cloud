import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { AiTurnBlock } from "../protocol";

const root = mkdtempSync(resolve(tmpdir(), "cloud-capability-block-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { AiTurnBlockView } = await import("./blocks");
const { AiChatActionsProvider } = await import("./message-actions");

const block = (status: "running" | "awaiting_approval" | "completed" | "failed"): AiTurnBlock => ({
  id: "tool-call-1",
  kind: "tool",
  callId: "call-1",
  name: "contacts__query__list",
  args: { limit: 10 },
  status,
  result: status === "running" || status === "awaiting_approval" ? undefined : { data: [] },
  isError: status === "failed",
  approval: status === "awaiting_approval" ? { message: "Create the contact?", allowAlways: false } : undefined,
  presentation: {
    kind: "capability",
    appId: "contacts",
    appName: "Contacts",
    appIcon: "ti ti-address-book",
    title: "List contacts",
    capabilityKind: "query",
  },
});

describe("capability tool presentation", () => {
  test("renders the owning app identity while running and after completion", () => {
    for (const status of ["running", "completed", "failed"] as const) {
      const html = renderToString(() => createComponent(AiTurnBlockView, { block: block(status), turnId: "turn-1" }));
      expect(html).toContain("Contacts: List contacts");
      expect(html).toContain("ti-address-book");
      expect(html).toContain("Query");
    }
  });

  test("keeps the app identity on approval prompts", () => {
    const html = renderToString(() => createComponent(AiTurnBlockView, { block: block("awaiting_approval"), turnId: "turn-1" }));
    expect(html).toContain("Approve Contacts: List contacts");
    expect(html).toContain("ti-address-book");
  });

  test("offers remembered approval through the approval split button", () => {
    const approvalBlock = block("awaiting_approval");
    if (approvalBlock.kind !== "tool" || !approvalBlock.approval) throw new Error("approval block missing");
    approvalBlock.approval.allowAlways = true;
    const html = renderToString(() =>
      createComponent(AiChatActionsProvider, {
        actions: { onApproval: async () => undefined },
        get children() {
          return createComponent(AiTurnBlockView, { block: approvalBlock, turnId: "turn-1" });
        },
      }),
    );

    expect(html).toContain("k2b-split-button");
    expect(html).toContain("Always approve");
    expect(html).toContain("More approval options for List contacts");
    expect(html).not.toContain("Always allow");
  });
});
