import type { DoneReason, Message, OutboundEvent, Provider, SessionStore, Tool, ToolContext } from "@valentinkolb/nessi";
import type { Usage } from "@valentinkolb/nessi/ai";
import type { z } from "zod";
import type { RequestActor } from "../server";

export const AI_MODEL_CAPABILITIES = ["streaming", "tools", "vision"] as const;
export type AiModelCapability = (typeof AI_MODEL_CAPABILITIES)[number];

export type AiProviderId = "openai" | "openrouter" | "anthropic" | "mistral" | "gemini" | "ollama" | "vllm" | "openai-compatible";

export const AI_DATA_BOUNDARIES = ["hosted", "private"] as const;
export type AiDataBoundary = (typeof AI_DATA_BOUNDARIES)[number];
/** @deprecated Use AiDataBoundary. */
export type AiDataPolicy = AiDataBoundary;

export type AiModelProfile = {
  id: string;
  label: string;
  provider: AiProviderId;
  model: string;
  enabled: boolean;
  capabilities: AiModelCapability[];
  dataBoundary: AiDataBoundary;
  apiKey?: string;
  /** Legacy: old profiles referenced global secret settings. New profiles store apiKey directly. */
  credentialSetting?: string;
  baseURL?: string;
  contextWindow?: number;
  temperature?: number;
  maxOutputTokens?: number;
  creditsPerInputToken?: number;
  creditsPerOutputToken?: number;
};

export type AiPublicModelProfile = Pick<AiModelProfile, "id" | "label" | "provider" | "model" | "capabilities" | "dataBoundary">;

export type AiSettingsErrorCode =
  | "ai_disabled"
  | "invalid_model_profiles"
  | "missing_default_model"
  | "default_model_disabled"
  | "missing_provider_credential"
  | "model_policy_mismatch";

export type AiSettingsError = {
  code: AiSettingsErrorCode;
  message: string;
  fields?: Record<string, string>;
};

export type AiSettingsState =
  | {
      ok: true;
      enabled: boolean;
      defaultModelId: string;
      globalInstructions: string;
      profiles: AiModelProfile[];
    }
  | {
      ok: false;
      enabled: boolean;
      defaultModelId: string;
      globalInstructions: string;
      profiles: AiModelProfile[];
      error: AiSettingsError;
    };

export type AiModelPolicy =
  | { kind: "platform-default"; allowedDataBoundaries?: AiDataBoundary[]; requiredCapabilities?: AiModelCapability[] }
  | { kind: "locked"; modelId: string; allowedDataBoundaries?: AiDataBoundary[]; requiredCapabilities?: AiModelCapability[] }
  | {
      kind: "selectable";
      defaultModelId?: string;
      allowedModelIds?: string[];
      allowedDataBoundaries?: AiDataBoundary[];
      requiredCapabilities?: AiModelCapability[];
    };

export type AiResolvedModel = {
  profile: AiModelProfile;
  provider: Provider;
};

export type AiConversationResource =
  | { kind: "direct" }
  | { kind: "resource"; appId: string; resourceType: string; resourceId: string; title?: string };

export type AiResourceDescriptor = {
  appId: string;
  resourceType: string;
  resourceId: string;
  title?: string;
};

export type AiConversation = {
  id: string;
  appId: string;
  title: string;
  resource: AiConversationResource;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiStoredMessage = {
  id: string;
  conversationId: string;
  seq: number;
  kind: "message" | "summary";
  message: Message;
  modelProfileId: string | null;
  providerModel: string | null;
  usage: Usage | null;
  stopReason: string | null;
  createdAt: string;
};

export type AiTurnStatus = "running" | "completed" | "failed" | "aborted";

export type AiTurn = {
  id: string;
  conversationId: string;
  status: AiTurnStatus;
  modelProfileId: string | null;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};

export type AiStreamEvent =
  | { type: "turn_start"; turnId: string; conversationId: string; modelProfileId: string; providerModel: string }
  | { type: "nessi"; turnId: string; conversationId: string; event: OutboundEvent }
  | {
      type: "approval_request";
      turnId: string;
      conversationId: string;
      callId: string;
      name: string;
      args: unknown;
      message?: string;
      allowAlways: boolean;
    }
  | {
      type: "frontend_tool";
      turnId: string;
      conversationId: string;
      callId: string;
      name: string;
      args: unknown;
      mode: AiFrontendToolMode;
    }
  | { type: "done"; turnId: string; conversationId: string; reason: DoneReason }
  | { type: "error"; turnId: string; conversationId: string; message: string; retryable?: boolean };

export type AiSseEvent = AiStreamEvent & {
  cursor?: string;
};

export type AiPendingTurnAction = Extract<AiStreamEvent, { type: "approval_request" | "frontend_tool" }>;

export type AiConversationStore = {
  createConversation(input: {
    appId: string;
    ownerUserId: string;
    title?: string;
    resource?: AiConversationResource;
  }): Promise<AiConversation>;
  listConversations(input: { appId: string; ownerUserId: string; resource?: AiConversationResource }): Promise<AiConversation[]>;
  getConversation(input: {
    conversationId: string;
    appId?: string;
    ownerUserId?: string;
    resource?: AiConversationResource;
  }): Promise<AiConversation | null>;
  listMessages(input: { conversationId: string }): Promise<AiStoredMessage[]>;
  createTurn(input: { conversationId: string; modelProfileId: string }): Promise<AiTurn>;
  getRunningTurn(input: { conversationId: string }): Promise<AiTurn | null>;
  completeTurn(input: { turnId: string; status: Exclude<AiTurnStatus, "running">; error?: string | null }): Promise<void>;
  createSessionStore(input: { conversationId: string; modelProfileId?: string | null }): SessionStore;
};

export type AiAccessResult<TAccess = unknown> = {
  allowed: boolean;
  data?: TAccess;
  reason?: string;
};

export type AiResourceHookContext<TParams, TAccess = unknown> = {
  params: TParams;
  actor: RequestActor;
  access: TAccess;
  signal: AbortSignal;
};

export type AiResourceDefinition<TParams, TAccess = unknown> = {
  id: string;
  appId: string;
  path: string;
  resourceId?: (keyof TParams & string) | ((ctx: AiResourceHookContext<TParams, TAccess>) => string | Promise<string>);
  resourceTitle?: string | ((ctx: AiResourceHookContext<TParams, TAccess>) => string | Promise<string>);
  access(input: { params: TParams; actor: RequestActor; signal: AbortSignal }): Promise<AiAccessResult<TAccess>>;
  modelPolicy?: AiModelPolicy | ((ctx: AiResourceHookContext<TParams, TAccess>) => AiModelPolicy | Promise<AiModelPolicy>);
  systemPrompt?: string | ((ctx: AiResourceHookContext<TParams, TAccess>) => string | Promise<string>);
  context?: (ctx: AiResourceHookContext<TParams, TAccess>) => string | Promise<string>;
  tools?: AiRuntimeTool[] | ((ctx: AiResourceHookContext<TParams, TAccess>) => AiRuntimeTool[] | Promise<AiRuntimeTool[]>);
};

export type AiToolApprovalPolicy = "never" | "once" | "always" | { kind: "user-configurable"; default: "once" | "always"; scope?: string };

export type AiFrontendToolMode = "client" | "client_view" | "client_interaction";

export type AiToolDefinition<TInput extends z.ZodType = z.ZodType, TOutput extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  approval: AiToolApprovalPolicy;
};

export type AiToolRuntime<TInput extends z.ZodType = z.ZodType, TOutput extends z.ZodType = z.ZodType> =
  | {
      location: "server";
      def: AiToolDefinition<TInput, TOutput>;
      run(input: z.infer<TInput>, ctx: ToolContext & { actor: RequestActor }): Promise<z.infer<TOutput>>;
    }
  | {
      location: AiFrontendToolMode;
      def: AiToolDefinition<TInput, TOutput>;
    };

export type AiRuntimeTool = Tool | AiToolRuntime;
