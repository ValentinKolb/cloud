import { describe, expect, test } from "bun:test";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import { bindMailWorkflow } from "../workflows/binder";
import { buildMailWorkflowCatalog } from "../workflows/catalog";
import { mailWorkflowManifest } from "../workflows/manifest";
import { buildSenderRuleWorkflowSource, senderRuleExistingDedupeKey } from "./sender-rules";

const catalog = buildMailWorkflowCatalog({
  folders: [{ id: "00000000-0000-4000-8000-000000000001", name: "Junk", role: "junk" }],
  assignableUsers: [],
});

describe("sender rule workflow source", () => {
  test.each([
    ["sender", "sender@example.com", { kind: "junk" as const }, "fromAddress"],
    ["domain", "example.com", { kind: "add_keyword" as const, keyword: "FollowUp" }, "fromDomain"],
  ] as const)("generates deterministic, bindable %s rules", async (matchKind, matchValue, action, field) => {
    const source = buildSenderRuleWorkflowSource({ matchKind, matchValue, action });

    expect(source).toBe(buildSenderRuleWorkflowSource({ matchKind, matchValue, action }));
    expect(source).toContain(`inputs.message.${field}`);
    expect(source).toContain(matchValue);

    const compiled = await compileWorkflow(source, mailWorkflowManifest);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect((await bindMailWorkflow(compiled.ir, catalog)).ok).toBe(true);
  });

  test("deduplicates one historical target per immutable rule revision", () => {
    expect(senderRuleExistingDedupeKey("rule", 3, "message")).toBe(senderRuleExistingDedupeKey("rule", 3, "message"));
    expect(senderRuleExistingDedupeKey("rule", 4, "message")).not.toBe(senderRuleExistingDedupeKey("rule", 3, "message"));
    expect(senderRuleExistingDedupeKey("rule", 3, "other")).not.toBe(senderRuleExistingDedupeKey("rule", 3, "message"));
  });
});
