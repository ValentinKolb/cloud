import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { nessi } from "@valentinkolb/nessi";
import type { OutboundEvent, StoreEntry } from "@valentinkolb/nessi";
import type { Provider } from "@valentinkolb/nessi/ai";
import type { RequestActor } from "../server";
import { aiToolAllowsAlways, aiToolApprovalScope, aiToolNeedsApproval } from "./approvals";
import { CloudAiCardInputSchema, createConfiguredDefaultCloudAiTools, createDefaultCloudAiTools } from "./default-tools";
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
    // Output validation now lives in nessi: the schema travels with the tool definition.
    expect(prepared.tools[0]?.def.outputSchema).toBe(tool.def.outputSchema);
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

  test("adds Firecrawl web tools only when configured", async () => {
    const withoutWeb = await createConfiguredDefaultCloudAiTools({ firecrawlApiKey: "" });
    const withWeb = await createConfiguredDefaultCloudAiTools({ firecrawlApiKey: "fc-secret" });

    expect(withoutWeb.map((tool) => tool.def.name)).toEqual(["card", "survey"]);
    expect(withWeb.map((tool) => tool.def.name)).toEqual(["card", "survey", "web_search", "web_extract"]);

    const prepared = prepareAiTools({ tools: withWeb, actor });
    expect(prepared.tools.find((tool) => tool.def.name === "web_search")?.kind).toBe("server");
    expect(prepared.tools.find((tool) => tool.def.name === "web_extract")?.kind).toBe("server");
    expect(prepared.approvalPolicies.get("web_search")).toBe("never");
    expect(prepared.approvalPolicies.get("web_extract")).toBe("never");
  });

  test("accepts flat highlight-card trend fields from model tool calls", () => {
    const parsed = CloudAiCardInputSchema.parse({
      title: "Latency",
      value: "42 ms",
      trendLabel: "vs last week",
      trendValue: "-8%",
      trendDirection: "down",
    });

    expect(parsed).toEqual({
      title: "Latency",
      value: "42 ms",
      tone: "teal",
      trendLabel: "vs last week",
      trendValue: "-8%",
      trendDirection: "down",
    });
  });

  test("rejects chart and table payloads for the KISS card tool", () => {
    expect(
      CloudAiCardInputSchema.safeParse({
        kind: "chart",
        title: "Latency",
        data: [{ label: "p95", value: 42 }],
      }).success,
    ).toBe(false);
    expect(
      CloudAiCardInputSchema.safeParse({
        kind: "table",
        title: "Projects",
        columns: ["Name", "Status"],
        rows: [["Website", "Done"]],
      }).success,
    ).toBe(false);
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

  test("default visual tool reaches Nessi client action requests", async () => {
    const entries: StoreEntry[] = [];
    const provider: Provider = {
      name: "fake",
      family: "openai-compatible",
      model: "fake/card",
      capabilities: { streaming: true, tools: true, images: false, thinking: false, usage: true },
      async *stream() {
        yield { type: "block_start", blockId: "block-0", index: 0, kind: "tool_call", callId: "call-card", name: "card" };
        yield { type: "block_delta", blockId: "block-0", delta: JSON.stringify({ title: "Status", value: "OK" }) };
        yield {
          type: "block_end",
          blockId: "block-0",
          index: 0,
          block: { type: "tool_call", id: "call-card", name: "card", args: { title: "Status", value: "OK" } },
        };
        yield { type: "usage", usage: { input: 1, output: 1, total: 2 }, finishReason: "tool_use" };
      },
      async complete() {
        throw new Error("complete should not be used");
      },
    };
    const prepared = prepareAiTools({ tools: createDefaultCloudAiTools(), actor });
    const loop = nessi({
      agentId: "cloud",
      loopId: "loop-card",
      input: "show a card",
      provider,
      systemPrompt: "",
      tools: prepared.tools,
      maxTurns: 1,
      store: {
        append: async (message) => {
          entries.push({ seq: entries.length + 1, kind: "message", message });
        },
        load: async () => entries,
      },
    });

    let actionRequest: Extract<OutboundEvent, { type: "tool_action_request" }> | undefined;
    for await (const event of loop) {
      if (event.type === "tool_action_request") {
        actionRequest = event;
        break;
      }
    }

    expect(actionRequest).toMatchObject({
      type: "tool_action_request",
      kind: "client_tool",
      callId: "call-card",
      name: "card",
      args: { title: "Status", value: "OK", tone: "teal", trendDirection: "flat" },
    });
  });
});
