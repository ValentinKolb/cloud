import { describe, expect, test } from "bun:test";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import { bindMailWorkflow } from "../workflows/binder";
import { buildMailWorkflowCatalog } from "../workflows/catalog";
import { mailWorkflowManifest } from "../workflows/manifest";
import { buildSenderRuleWorkflowSource, senderRuleExistingDedupeKey } from "./sender-rules";

const catalog = buildMailWorkflowCatalog({
  folders: [
    { id: "00000000-0000-4000-8000-000000000001", name: "Junk", role: "junk" },
    { id: "00000000-0000-4000-8000-000000000002", name: "Customers" },
  ],
  assignableUsers: [{ id: "00000000-0000-4000-8000-000000000003", name: "Ada" }],
  localTags: [{ id: "00000000-0000-4000-8000-000000000004", name: "Important" }],
});

describe("sender rule workflow source", () => {
  test.each([
    ["sender", "sender@example.com", [{ kind: "junk" as const }], "fromAddress"],
    ["domain", "example.com", [{ kind: "add_keyword" as const, keyword: "FollowUp" }], "fromDomain"],
  ] as const)("generates deterministic, bindable %s rules", async (matchKind, matchValue, actions, field) => {
    const source = buildSenderRuleWorkflowSource({ matchKind, matchValue, actions: [...actions] });

    expect(source).toBe(buildSenderRuleWorkflowSource({ matchKind, matchValue, actions: [...actions] }));
    expect(source).toContain(`inputs.message.${field}`);
    expect(source).toContain(matchValue);

    const compiled = await compileWorkflow(source, mailWorkflowManifest);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect((await bindMailWorkflow(compiled.ir, catalog)).ok).toBe(true);
  });

  test("generates one ordered workflow branch for provider and collaboration actions", async () => {
    const source = buildSenderRuleWorkflowSource({
      matchKind: "sender",
      matchValue: "sender@example.com",
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
    const compiled = await compileWorkflow(source, mailWorkflowManifest);
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
    expect(senderRuleExistingDedupeKey("rule", "version-3", "message")).toBe(senderRuleExistingDedupeKey("rule", "version-3", "message"));
    expect(senderRuleExistingDedupeKey("rule", "version-4", "message")).not.toBe(
      senderRuleExistingDedupeKey("rule", "version-3", "message"),
    );
    expect(senderRuleExistingDedupeKey("rule", "version-3", "other")).not.toBe(senderRuleExistingDedupeKey("rule", "version-3", "message"));
  });
});
