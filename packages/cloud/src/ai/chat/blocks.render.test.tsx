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
  approval:
    status === "awaiting_approval"
      ? { message: "Contacts: List contacts\nReview the validated arguments below before running this Action.", allowAlways: false }
      : undefined,
  presentation: {
    kind: "capability",
    appId: "contacts",
    appName: "Contacts",
    appIcon: "ti ti-address-book",
    appAccent: "#0f766e",
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
      expect(html).toContain("--k2b-chat-activity-accent:#0f766e");
    }
  });

  test("renders persisted local Bash calls without execution controls", () => {
    const completed: AiTurnBlock = {
      id: "bash-call-1",
      kind: "tool",
      callId: "bash-1",
      name: "local_bash",
      args: { command: "git status --short" },
      status: "completed",
      result: { status: "completed", exitCode: 0, stdout: "", stderr: "", truncated: false },
      isError: false,
    };
    const pending: AiTurnBlock = { ...completed, status: "awaiting_client", result: undefined };

    const completedHtml = renderToString(() => createComponent(AiTurnBlockView, { block: completed, turnId: "turn-1" }));
    const pendingHtml = renderToString(() => createComponent(AiTurnBlockView, { block: pending, turnId: "turn-1" }));

    expect(completedHtml).toContain("Local Bash");
    expect(completedHtml).toContain("git status --short");
    expect(pendingHtml).toContain("Local Bash");
    expect(pendingHtml).not.toContain("Approve");
    expect(pendingHtml).not.toContain("Run");
  });

  test("keeps the app identity on approval prompts", () => {
    const renderApproval = (approvalBlock: AiTurnBlock) =>
      renderToString(() =>
        createComponent(AiChatActionsProvider, {
          actions: { onApproval: async () => undefined },
          get children() {
            return createComponent(AiTurnBlockView, { block: approvalBlock, turnId: "turn-1" });
          },
        }),
      );
    const html = renderApproval(block("awaiting_approval"));
    expect(html).toContain(">Contacts</h3>");
    expect(html).toContain("List contacts");
    expect(html).toContain('data-variant="ai"');
    expect(html).toContain('<span class="k2b-button__label">List contacts</span>');
    expect(html).not.toContain("Contacts: List contacts");
    expect(html).not.toContain("Approve Contacts: List contacts");
    expect(html).not.toContain("Review the validated arguments");
    expect(html).not.toContain("Contacts · Approval required");
    expect(html).toContain("ti-address-book");
    expect(html).toContain("--app-accent:#0f766e");
    expect(html).toContain("app-accent-scope");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("k2b-content-structured-data");

    const rememberable = block("awaiting_approval");
    if (rememberable.kind !== "tool" || !rememberable.approval) throw new Error("approval block missing");
    rememberable.approval.allowAlways = true;
    const rememberableHtml = renderApproval(rememberable);
    expect(rememberableHtml).toContain("k2b-split-button");
    expect(rememberableHtml).toContain("Always approve");
    expect(rememberableHtml).toContain("More approval options for List contacts");
    expect(rememberableHtml).not.toContain("Always allow");

    const customReview = block("awaiting_approval");
    if (customReview.kind !== "tool" || !customReview.approval) throw new Error("approval block missing");
    customReview.approval.message = "The draft includes an external recipient.\nSubject: Release follow-up\nRecipients: Ada";
    const customHtml = renderApproval(customReview);
    expect(customHtml).toContain("The draft includes an external recipient.");
    expect(customHtml).toContain('<strong class="font-semibold text-primary">Subject: </strong>Release follow-up');
    expect(customHtml).toContain('<strong class="font-semibold text-primary">Recipients: </strong>Ada');
    expect(customHtml).toContain('class="mt-3 flex flex-col gap-1 text-xs leading-5 text-secondary"');
  });
});
