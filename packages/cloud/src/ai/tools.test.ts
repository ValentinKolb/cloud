import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { RequestActor } from "../server";
import { aiToolAllowsAlways, aiToolApprovalScope, aiToolNeedsApproval } from "./approvals";
import { CloudAiCardInputSchema, createDefaultCloudAiTools } from "./default-tools";
import { AiTurnActionSchema } from "./runtime";
import { defineAiTool, prepareAiTools } from "./tools";

const actor = {
  kind: "user",
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    uid: "tester",
    roles: ["user"],
    provider: "local",
  },
} as RequestActor;

describe("AI tools", () => {
  test("maps Cloud server tools to Nessi server tools with approval", () => {
    const tool = defineAiTool({
      name: "create_record",
      description: "Create a record",
      inputSchema: z.object({ title: z.string() }),
      outputSchema: z.object({ id: z.string() }),
      approval: "once",
    }).server(async ({ title }) => ({ id: title }));

    const prepared = prepareAiTools({ tools: [tool], actor });

    expect(prepared.tools[0]?.kind).toBe("server");
    expect(prepared.tools[0]?.def.needsApproval).toBe(true);
    expect(prepared.approvalPolicies.get("create_record")).toBe("once");
  });

  test("maps frontend interaction tools to Nessi client tools with mode metadata", () => {
    const tool = defineAiTool({
      name: "survey",
      description: "Ask the user a survey question",
      inputSchema: z.object({ question: z.string() }),
      outputSchema: z.object({ answer: z.string() }),
      approval: { kind: "user-configurable", default: "always", scope: "survey" },
    }).clientInteraction();

    const prepared = prepareAiTools({ tools: [tool], actor });

    expect(prepared.tools[0]?.kind).toBe("client");
    expect(prepared.frontendModes.get("survey")).toBe("client_interaction");
    expect(prepared.approvalPolicies.get("survey")).toEqual({ kind: "user-configurable", default: "always", scope: "survey" });
    expect(prepared.outputSchemas.get("survey")).toBe(tool.def.outputSchema);
  });

  test("ships default visual and survey tools as frontend tools", () => {
    const prepared = prepareAiTools({ tools: createDefaultCloudAiTools(), actor });

    expect(prepared.tools.map((tool) => tool.def.name)).toEqual(["card", "survey"]);
    expect(prepared.tools.every((tool) => tool.kind === "client")).toBe(true);
    expect(prepared.frontendModes.get("card")).toBe("client_view");
    expect(prepared.frontendModes.get("survey")).toBe("client_interaction");
    expect(prepared.approvalPolicies.get("card")).toBe("never");
    expect(prepared.approvalPolicies.get("survey")).toBe("never");
  });

  test("accepts stringified stat-card trend objects from model tool calls", () => {
    const parsed = CloudAiCardInputSchema.parse({
      kind: "stat_card",
      title: "Latency",
      value: "42 ms",
      trend: JSON.stringify({ label: "vs last week", value: "-8%", direction: "down" }),
    });

    expect(parsed.kind).toBe("stat_card");
    if (parsed.kind !== "stat_card") throw new Error("Expected stat card");
    expect(parsed.trend).toEqual({ label: "vs last week", value: "-8%", direction: "down" });
  });

  test("evaluates approval policies for per-user always-allow preferences", () => {
    expect(aiToolNeedsApproval("never")).toBe(false);
    expect(aiToolNeedsApproval("once")).toBe(true);
    expect(aiToolAllowsAlways("once")).toBe(false);
    expect(aiToolAllowsAlways("always")).toBe(true);
    expect(aiToolAllowsAlways({ kind: "user-configurable", default: "once" })).toBe(true);
    expect(aiToolApprovalScope("write_grid", { kind: "user-configurable", default: "once", scope: "grid-write" })).toBe("grid-write");
  });

  test("validates turn continuation actions", () => {
    expect(AiTurnActionSchema.safeParse({ type: "approval_response", approved: true, remember: "always" }).success).toBe(true);
    expect(AiTurnActionSchema.safeParse({ type: "tool_result", result: { answer: "yes" } }).success).toBe(true);
    expect(AiTurnActionSchema.safeParse({ type: "approval_response", result: "wrong" }).success).toBe(false);
  });
});
