import { describe, expect, test } from "bun:test";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import type { MailAutomationStep } from "../contracts";
import { bindMailWorkflow } from "../workflows/binder";
import { buildMailWorkflowCatalog } from "../workflows/catalog";
import { mailWorkflows } from "../workflows/module";
import { buildIncomingAutomationWorkflowSource, incomingAutomationBudget, incomingAutomationHasAi } from "./incoming-automation-definition";

const classifyId = "00000000-0000-4000-8000-000000000001";
const importantId = "00000000-0000-4000-8000-000000000002";
const routineId = "00000000-0000-4000-8000-000000000003";

describe("incoming automation workflow compiler", () => {
  test("compiles mixed compound blocks deterministically", async () => {
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
          {
            id: importantId,
            name: "Important",
            description: "Needs attention",
            steps: [
              { id: "00000000-0000-4000-8000-000000000012", kind: "mail_action", action: { kind: "set_status", status: "needs_action" } },
              {
                id: "00000000-0000-4000-8000-000000000017",
                kind: "ai_generate_text",
                instructions: "Draft a concise reply",
                maxOutputChars: 2_000,
                replyDraft: { senderIdentityId: "00000000-0000-4000-8000-000000000018" },
              },
            ],
          },
          {
            id: routineId,
            name: "Routine",
            description: "Routine mail",
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
    expect(source).toContain("createReplyDraft:");
    expect(incomingAutomationHasAi(steps)).toBe(true);
    expect(incomingAutomationBudget(steps)).toMatchObject({ maxTargets: 4, maxDrafts: 1, maxAiCalls: 2 });
    const compiled = await compileWorkflow(source, mailWorkflows);
    expect(compiled.ok).toBe(true);
  });

  test("compiles match conditions and compound AI draft creation", async () => {
    const textId = "00000000-0000-4000-8000-000000000020";
    const source = buildIncomingAutomationWorkflowSource({
      scope: {
        mode: "matching",
        conditions: { mode: "all", items: [{ field: "sender_domain", operator: "is", value: "example.com" }] },
      },
      steps: [
        {
          id: textId,
          kind: "ai_generate_text",
          instructions: "Write a reply",
          maxOutputChars: 2_000,
          replyDraft: { senderIdentityId: "00000000-0000-4000-8000-000000000022" },
        },
      ],
    });
    expect(source).toContain("inputs.message.fromDomain");
    expect(source).toContain("aiGenerateText:");
    expect(source).toContain("createReplyDraft:");
    expect(source).toContain("{{ step_00000000000040008000000000000020 }}");
    expect((await compileWorkflow(source, mailWorkflows)).ok).toBe(true);
  });

  test("compiles sparse multi-classification routes", async () => {
    const source = buildIncomingAutomationWorkflowSource({
      scope: { mode: "all" },
      steps: [
        {
          id: classifyId,
          kind: "ai_classify_many",
          instructions: "Choose every matching category",
          choices: [
            {
              id: importantId,
              name: "Important",
              description: "Needs attention",
              steps: [
                {
                  id: "00000000-0000-4000-8000-000000000031",
                  kind: "mail_action",
                  action: { kind: "set_status", status: "needs_action" },
                },
              ],
            },
            { id: routineId, name: "Routine", description: "Routine mail", steps: [] },
          ],
          maxChoices: 2,
          fallback: [{ id: "00000000-0000-4000-8000-000000000032", kind: "mail_action", action: { kind: "mark_read" } }],
        },
      ],
    });
    expect(source).toContain("aiClassifyMany:");
    expect(source).toContain("includes:");
    expect(source).toContain("not:");
    const compiled = await compileWorkflow(source, mailWorkflows);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(
        (
          await bindMailWorkflow(
            compiled.ir,
            buildMailWorkflowCatalog({ folders: [], assignableUsers: [], senderIdentities: [], localTags: [] }),
          )
        ).ok,
      ).toBe(true);
    }
  });

  test("binds mutually exclusive multi-classification fallback actions", async () => {
    const source = buildIncomingAutomationWorkflowSource({
      scope: { mode: "all" },
      steps: [
        {
          id: classifyId,
          kind: "ai_classify_many",
          instructions: "Choose up to two matching categories",
          choices: [
            {
              id: importantId,
              name: "Important",
              description: "Needs attention",
              steps: [{ id: "00000000-0000-4000-8000-000000000041", kind: "mail_action", action: { kind: "junk" } }],
            },
            { id: routineId, name: "Routine", description: "Routine mail", steps: [] },
          ],
          maxChoices: 2,
          fallback: [{ id: "00000000-0000-4000-8000-000000000042", kind: "mail_action", action: { kind: "trash" } }],
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
