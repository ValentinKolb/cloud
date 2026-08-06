import { describe, expect, test } from "bun:test";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import type { MailAutomationStep } from "../contracts";
import { bindMailWorkflow } from "../workflows/binder";
import { buildMailWorkflowCatalog } from "../workflows/catalog";
import { mailWorkflows } from "../workflows/module";
import { buildIncomingAutomationWorkflowSource, incomingAutomationBudget, incomingAutomationHasAi } from "./incoming-automation-definition";

const classifyId = "00000000-0000-4000-8000-000000000001";
describe("incoming automation workflow compiler", () => {
  test("compiles normal output references and conditions deterministically", async () => {
    const textId = "00000000-0000-4000-8000-000000000017";
    const steps: MailAutomationStep[] = [
      {
        id: "00000000-0000-4000-8000-000000000010",
        kind: "mail_action",
        action: { kind: "add_local_tag", tagId: "00000000-0000-4000-8000-000000000014" },
      },
      {
        id: classifyId,
        kind: "ai_classify",
        instructions: "Choose the best category",
        choices: [
          { name: "Important", description: "Needs attention" },
          { name: "Routine", description: "Routine mail" },
        ],
      },
      {
        id: "00000000-0000-4000-8000-000000000011",
        kind: "if",
        condition: { sourceStepId: classifyId, operator: "equals", value: "Important" },
        then: [
          { id: "00000000-0000-4000-8000-000000000012", kind: "mail_action", action: { kind: "set_status", status: "needs_action" } },
          { id: textId, kind: "ai_generate_text", instructions: "Draft a concise reply", maxOutputChars: 2_000 },
          {
            id: "00000000-0000-4000-8000-000000000018",
            kind: "create_reply_draft",
            body: { sourceStepId: textId },
            senderIdentityId: "00000000-0000-4000-8000-000000000019",
          },
          { id: "00000000-0000-4000-8000-000000000020", kind: "add_comment", body: { sourceStepId: textId } },
        ],
        else: [{ id: "00000000-0000-4000-8000-000000000013", kind: "mail_action", action: { kind: "add_keyword", keyword: "routine" } }],
      },
    ];
    const input = { scope: { mode: "all" as const }, steps };
    const source = buildIncomingAutomationWorkflowSource(input);
    expect(source).toBe(buildIncomingAutomationWorkflowSource(input));
    expect(source).toContain("aiClassify:");
    expect(source).toContain("equals:\n");
    expect(source).toContain("setConversationStatus:");
    expect(source).toContain("addKeyword:");
    expect(source).toContain("createReplyDraft:");
    expect(source).toContain("addComment:");
    expect(source).toContain("{{ step_00000000000040008000000000000017 }}");
    expect(incomingAutomationHasAi(steps)).toBe(true);
    expect(incomingAutomationBudget(steps)).toMatchObject({ maxTargets: 4, maxDrafts: 1, maxCollaborationChanges: 3, maxAiCalls: 2 });
    expect((await compileWorkflow(source, mailWorkflows)).ok).toBe(true);
  });

  test("compiles match conditions and multiple consumers of one text output", async () => {
    const textId = "00000000-0000-4000-8000-000000000020";
    const source = buildIncomingAutomationWorkflowSource({
      scope: {
        mode: "matching",
        conditions: { mode: "all", items: [{ field: "sender_domain", operator: "is", value: "example.com" }] },
      },
      steps: [
        { id: textId, kind: "ai_generate_text", instructions: "Summarize this message", maxOutputChars: 2_000 },
        {
          id: "00000000-0000-4000-8000-000000000021",
          kind: "create_reply_draft",
          body: { sourceStepId: textId },
          senderIdentityId: "00000000-0000-4000-8000-000000000022",
        },
        { id: "00000000-0000-4000-8000-000000000023", kind: "add_comment", body: { sourceStepId: textId } },
      ],
    });
    expect(source).toContain("inputs.message.fromDomain");
    expect(source).toContain("aiGenerateText:");
    expect(source).toContain("createReplyDraft:");
    expect(source).toContain("addComment:");
    expect(source.match(/{{ step_00000000000040008000000000000020 }}/g)).toHaveLength(2);
    expect((await compileWorkflow(source, mailWorkflows)).ok).toBe(true);
  });

  test("compiles multi-classification as ordinary sequential conditions", async () => {
    const source = buildIncomingAutomationWorkflowSource({
      scope: { mode: "all" },
      steps: [
        {
          id: classifyId,
          kind: "ai_classify_many",
          instructions: "Choose matching categories",
          choices: [
            { name: "Important", description: "Needs attention" },
            { name: "Routine", description: "Routine mail" },
          ],
          maxChoices: 2,
        },
        {
          id: "00000000-0000-4000-8000-000000000030",
          kind: "if",
          condition: { sourceStepId: classifyId, operator: "includes", value: "Important" },
          then: [
            { id: "00000000-0000-4000-8000-000000000031", kind: "mail_action", action: { kind: "set_status", status: "needs_action" } },
          ],
          else: [],
        },
        {
          id: "00000000-0000-4000-8000-000000000032",
          kind: "if",
          condition: { sourceStepId: classifyId, operator: "includes", value: "Routine" },
          then: [
            {
              id: "00000000-0000-4000-8000-000000000033",
              kind: "mail_action",
              action: { kind: "add_local_tag", tagId: "00000000-0000-4000-8000-000000000034" },
            },
          ],
          else: [],
        },
      ],
    });
    expect(source).toContain("aiClassifyMany:");
    expect(source.match(/includes:/g)).toHaveLength(2);
    expect((await compileWorkflow(source, mailWorkflows)).ok).toBe(true);
  });

  test("binds provider mutations in mutually exclusive if branches", async () => {
    const source = buildIncomingAutomationWorkflowSource({
      scope: { mode: "all" },
      steps: [
        {
          id: classifyId,
          kind: "ai_classify",
          instructions: "Choose one category",
          choices: [
            { name: "Important", description: "Needs attention" },
            { name: "Routine", description: "Routine mail" },
          ],
        },
        {
          id: "00000000-0000-4000-8000-000000000040",
          kind: "if",
          condition: { sourceStepId: classifyId, operator: "equals", value: "Important" },
          then: [{ id: "00000000-0000-4000-8000-000000000041", kind: "mail_action", action: { kind: "junk" } }],
          else: [{ id: "00000000-0000-4000-8000-000000000042", kind: "mail_action", action: { kind: "trash" } }],
        },
      ],
    });
    const compiled = await compileWorkflow(source, mailWorkflows);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const bound = await bindMailWorkflow(
      compiled.ir,
      buildMailWorkflowCatalog({
        folders: [
          { id: "00000000-0000-4000-8000-000000000043", name: "Junk", role: "junk" },
          { id: "00000000-0000-4000-8000-000000000044", name: "Trash", role: "trash" },
        ],
        assignableUsers: [],
        senderIdentities: [],
        localTags: [],
      }),
    );
    expect(bound.ok).toBe(true);
  });
});
