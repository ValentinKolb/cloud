import { describe, expect, test } from "bun:test";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import { bindMailWorkflow } from "../workflows/binder";
import { buildMailWorkflowCatalog } from "../workflows/catalog";
import { mailWorkflows } from "../workflows/module";
import { buildMailRuleWorkflowSource, mailRuleExistingDedupeKey } from "./mail-rules";

const catalog = buildMailWorkflowCatalog({
  folders: [
    { id: "00000000-0000-4000-8000-000000000001", name: "Junk", role: "junk" },
    { id: "00000000-0000-4000-8000-000000000002", name: "Customers" },
  ],
  assignableUsers: [{ id: "00000000-0000-4000-8000-000000000003", name: "Ada" }],
  localTags: [{ id: "00000000-0000-4000-8000-000000000004", name: "Important" }],
});

describe("mail rule workflow source", () => {
  test.each([
    [
      { field: "sender_address" as const, operator: "is" as const, value: "sender@example.com" },
      [{ kind: "junk" as const }],
      "fromAddress",
    ],
    [
      { field: "sender_domain" as const, operator: "is" as const, value: "example.com" },
      [{ kind: "add_keyword" as const, keyword: "FollowUp" }],
      "fromDomain",
    ],
  ] as const)("generates deterministic, bindable rules", async (condition, actions, field) => {
    const input = { conditions: { mode: "all" as const, items: [condition] }, actions: [...actions] };
    const source = buildMailRuleWorkflowSource(input);

    expect(source).toBe(buildMailRuleWorkflowSource(input));
    expect(source).toContain(`inputs.message.${field}`);
    expect(source).toContain(condition.value);

    const compiled = await compileWorkflow(source, mailWorkflows);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect((await bindMailWorkflow(compiled.ir, catalog)).ok).toBe(true);
  });

  test("generates one ordered workflow branch for provider and collaboration actions", async () => {
    const source = buildMailRuleWorkflowSource({
      conditions: {
        mode: "all",
        items: [
          { field: "sender_address", operator: "is", value: "sender@example.com" },
          { field: "subject", operator: "is", value: "invoice" },
          { field: "attachment_presence", operator: "is", value: true },
        ],
      },
      actions: [
        { kind: "move_to_folder", folderId: "00000000-0000-4000-8000-000000000002" },
        { kind: "add_local_tag", tagId: "00000000-0000-4000-8000-000000000004" },
        { kind: "assign_user", userId: "00000000-0000-4000-8000-000000000003" },
        { kind: "set_status", status: "needs_action" },
      ],
    });

    expect(source.indexOf("moveMessage")).toBeLessThan(source.indexOf("addLocalTag"));
    expect(source.indexOf("addLocalTag")).toBeLessThan(source.indexOf("assignConversation"));
    expect(source.indexOf("assignConversation")).toBeLessThan(source.indexOf("setConversationStatus"));
    expect(source).toContain("textEquals");
    expect(source).toContain("attachments.0");
    const compiled = await compileWorkflow(source, mailWorkflows);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const bound = await bindMailWorkflow(compiled.ir, catalog);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(bound.plan.bindings).toEqual({
      "steps.0.then.0.moveMessage.folder": "00000000-0000-4000-8000-000000000002",
      "steps.0.then.1.addLocalTag.tag": "00000000-0000-4000-8000-000000000004",
      "steps.0.then.2.assignConversation.user": "00000000-0000-4000-8000-000000000003",
    });
  });

  test("deduplicates one historical target per immutable workflow version", () => {
    expect(mailRuleExistingDedupeKey("rule", "version-3", "message")).toBe(mailRuleExistingDedupeKey("rule", "version-3", "message"));
    expect(mailRuleExistingDedupeKey("rule", "version-4", "message")).not.toBe(mailRuleExistingDedupeKey("rule", "version-3", "message"));
    expect(mailRuleExistingDedupeKey("rule", "version-3", "other")).not.toBe(mailRuleExistingDedupeKey("rule", "version-3", "message"));
  });
});
