import type { Tool, ToolContext } from "@valentinkolb/nessi";
import { defineTool as defineNessiTool } from "@valentinkolb/nessi";
import type { z } from "zod";
import type { RequestActor } from "../server";
import { aiToolNeedsApproval } from "./approvals";
import type { AiFrontendToolMode, AiRuntimeTool, AiToolApprovalPolicy, AiToolDefinition, AiToolRuntime } from "./types";

export const defineAiTool = <TInput extends z.ZodType, TOutput extends z.ZodType>(config: {
  name: string;
  description: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  approval?: AiToolApprovalPolicy;
}) => {
  const def: AiToolDefinition<TInput, TOutput> = {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    approval: config.approval ?? "once",
  };

  return {
    def,
    server(
      run: (input: z.infer<TInput>, ctx: ToolContext & { actor: RequestActor }) => Promise<z.infer<TOutput>>,
    ): AiToolRuntime<TInput, TOutput> {
      return { location: "server", def, run };
    },
    client(): AiToolRuntime<TInput, TOutput> {
      return { location: "client", def };
    },
    clientView(): AiToolRuntime<TInput, TOutput> {
      return { location: "client_view", def };
    },
    clientInteraction(): AiToolRuntime<TInput, TOutput> {
      return { location: "client_interaction", def };
    },
  };
};

export const isFrontendToolMode = (mode: string): mode is AiFrontendToolMode =>
  mode === "client" || mode === "client_view" || mode === "client_interaction";

const isCloudAiTool = (tool: AiRuntimeTool): tool is AiToolRuntime => "location" in tool && "def" in tool;

export type PreparedAiTools = {
  tools: Tool[];
  approvalPolicies: Map<string, AiToolApprovalPolicy>;
  frontendModes: Map<string, AiFrontendToolMode>;
  outputSchemas: Map<string, z.ZodType>;
};

export const prepareAiTools = (input: { tools?: AiRuntimeTool[]; actor?: RequestActor }): PreparedAiTools => {
  const approvalPolicies = new Map<string, AiToolApprovalPolicy>();
  const frontendModes = new Map<string, AiFrontendToolMode>();
  const outputSchemas = new Map<string, z.ZodType>();

  const tools = (input.tools ?? []).map((tool): Tool => {
    if (!isCloudAiTool(tool)) {
      if (tool.kind === "client" && tool.def.outputSchema) outputSchemas.set(tool.def.name, tool.def.outputSchema);
      return tool;
    }

    approvalPolicies.set(tool.def.name, tool.def.approval);
    outputSchemas.set(tool.def.name, tool.def.outputSchema);

    const nessiTool = defineNessiTool({
      name: tool.def.name,
      description: tool.def.description,
      inputSchema: tool.def.inputSchema,
      outputSchema: tool.def.outputSchema,
      needsApproval: tool.location === "server" && aiToolNeedsApproval(tool.def.approval),
    });

    if (tool.location === "server") {
      return nessiTool.server((toolInput, ctx) => {
        if (!input.actor) throw new Error(`AI server tool "${tool.def.name}" requires a request actor.`);
        return tool.run(toolInput, { ...ctx, actor: input.actor });
      });
    }

    frontendModes.set(tool.def.name, tool.location);
    return nessiTool.client(async () => {
      throw new Error(`Frontend AI tool "${tool.def.name}" must be executed by the browser.`);
    });
  });

  return { tools, approvalPolicies, frontendModes, outputSchemas };
};
