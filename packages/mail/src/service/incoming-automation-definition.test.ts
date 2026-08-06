import { describe, expect, test } from "bun:test";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import type { MailAutomationStep } from "../contracts";
import { mailWorkflows } from "../workflows/module";
import { buildIncomingAutomationWorkflowSource, incomingAutomationBudget, incomingAutomationHasAi } from "./incoming-automation-definition";

const classifyId = "00000000-0000-4000-8000-000000000001";
const importantId = "00000000-0000-4000-8000-000000000002";
const routineId = "00000000-0000-4000-8000-000000000003";

describe("incoming automation workflow compiler", () => {
  test("compiles mixed steps and branches deterministically", async () => {
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
          { id: importantId, name: "Important", description: "Needs attention" },
          { id: routineId, name: "Routine", description: "Routine mail" },
        ],
      },
      {
        id: "00000000-0000-4000-8000-000000000011",
        kind: "branch",
        sourceStepId: classifyId,
        cases: [
          {
            choiceId: importantId,
            steps: [
              { id: "00000000-0000-4000-8000-000000000012", kind: "mail_action", action: { kind: "set_status", status: "needs_action" } },
            ],
          },
          {
            choiceId: routineId,
            steps: [
              { id: "00000000-0000-4000-8000-000000000013", kind: "mail_action", action: { kind: "add_keyword", keyword: "routine" } },
            ],
          },
        ],
        fallback: [],
      },
    ];
    const input = { scope: { mode: "all" as const }, steps };
    const source = buildIncomingAutomationWorkflowSource(input);
    expect(source).toBe(buildIncomingAutomationWorkflowSource(input));
    expect(source).toContain("aiClassify:");
    expect(source).toContain("equals:\n");
    expect(source).toContain("- Important");
    expect(source).toContain("setConversationStatus:");
    expect(source).toContain("addKeyword:");
    expect(incomingAutomationHasAi(steps)).toBe(true);
    expect(incomingAutomationBudget(steps)).toMatchObject({ maxTargets: 3, maxAiCalls: 1 });
    expect((await compileWorkflow(source, mailWorkflows)).ok).toBe(true);
  });

  test("compiles match conditions and draft creation from earlier AI text", async () => {
    const textId = "00000000-0000-4000-8000-000000000020";
    const source = buildIncomingAutomationWorkflowSource({
      scope: {
        mode: "matching",
        conditions: { mode: "all", items: [{ field: "sender_domain", operator: "is", value: "example.com" }] },
      },
      steps: [
        { id: textId, kind: "ai_generate_text", instructions: "Write a reply", maxOutputChars: 2_000 },
        {
          id: "00000000-0000-4000-8000-000000000021",
          kind: "create_reply_draft",
          sourceStepId: textId,
          senderIdentityId: "00000000-0000-4000-8000-000000000022",
        },
      ],
    });
    expect(source).toContain("inputs.message.fromDomain");
    expect(source).toContain("aiGenerateText:");
    expect(source).toContain("createReplyDraft:");
    expect(source).toContain("{{ step_00000000000040008000000000000020 }}");
    expect((await compileWorkflow(source, mailWorkflows)).ok).toBe(true);
  });
});
