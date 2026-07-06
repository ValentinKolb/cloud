import type {
  ContentPart,
  DoneReason,
  InboundEvent,
  Input,
  LoopAggregate,
  Message,
  OutboundEvent,
  Provider,
  SessionStore,
  Tool,
  ToolContext,
} from "@valentinkolb/nessi";
import type { Usage } from "@valentinkolb/nessi/ai";
import type { z } from "zod";
import type { RequestActor } from "../server";

export const AI_MODEL_CAPABILITIES = ["streaming", "tools", "vision"] as const;
export type AiModelCapability = (typeof AI_MODEL_CAPABILITIES)[number];

export const AI_IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"] as const;
export type AiImageMediaType = (typeof AI_IMAGE_MEDIA_TYPES)[number];
export const isAiImageMediaType = (value: string): value is AiImageMediaType =>
  AI_IMAGE_MEDIA_TYPES.some((mediaType) => mediaType === value);

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

export type AiPublicModelProfile = Pick<
  AiModelProfile,
  "id" | "label" | "provider" | "model" | "capabilities" | "dataBoundary" | "contextWindow"
>;

export type AiUserContentPart = ContentPart;

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
      compactionPrompt: string;
      maxToolResultChars: number;
      profiles: AiModelProfile[];
    }
  | {
      ok: false;
      enabled: boolean;
      defaultModelId: string;
      globalInstructions: string;
      compactionPrompt: string;
      maxToolResultChars: number;
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
  icon: string;
  description: string;
  resource: AiConversationResource;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiConversationPage = {
  items: AiConversation[];
  total: number;
  page: number;
  perPage: number;
  hasNext: boolean;
};

export type AiStoredMessage = {
  id: string;
  conversationId: string;
  seq: number;
  kind: "message" | "summary";
  message: Message;
  loopId: string | null;
  modelProfileId: string | null;
  providerModel: string | null;
  usage: Usage | null;
  stopReason: string | null;
  loopAggregate: LoopAggregate | null;
  loopDoneReason: DoneReason | null;
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

type AiStreamEventBase = {
  turnId: string;
  conversationId: string;
  /** Stable logical Nessi loop id. Optional so old persisted events still replay. */
  loopId?: string;
};

export type AiStreamEvent =
  | (AiStreamEventBase & { type: "turn_start"; modelProfileId: string; providerModel: string })
  | (AiStreamEventBase & { type: "nessi"; event: OutboundEvent })
  | (AiStreamEventBase & {
      type: "approval_request";
      callId: string;
      name: string;
      args: unknown;
      message?: string;
      allowAlways: boolean;
    })
  | (AiStreamEventBase & {
      type: "frontend_tool";
      callId: string;
      name: string;
      args: unknown;
      mode: AiFrontendToolMode;
    })
  | (AiStreamEventBase & { type: "done"; reason: DoneReason; aggregate: LoopAggregate | null })
  | (AiStreamEventBase & { type: "error"; message: string; retryable?: boolean });

export type AiSseEvent = AiStreamEvent & {
  cursor?: string;
};

export type AiPendingTurnAction = Extract<AiStreamEvent, { type: "approval_request" | "frontend_tool" }>;

export type AiTurnAbortResult =
  | { found: true; status: AiTurnStatus; aborted: boolean }
  | { found: false; status: null; aborted: false };

export type AiPendingTurnActionRecord = {
  turnId: string;
  conversationId: string;
  callId: string;
  kind: "approval" | "custom_approval" | "client_tool";
  name: string;
  args: unknown;
  message?: string;
  approvalScope: string;
  allowAlways: boolean;
  frontendMode?: AiFrontendToolMode;
  resolvedEvent: InboundEvent | null;
};

export type AiTurnToolSource =
  | { kind: "none" }
  | { kind: "default" }
  | { kind: "resource"; resourceKey: string; params: Record<string, string> };

export type AiTurnRunConfig = {
  input: Input;
  actor?: RequestActor;
  modelPolicy?: AiModelPolicy;
  requestedModelId?: string;
  systemPrompt?: string;
  resourceContext?: string;
  toolSource?: AiTurnToolSource;
  toolApprovalContext?: {
    actorUserId: string;
    appId: string;
    resource?: AiConversationResource;
  };
};

export type AiStoredTurnEvent = AiSseEvent & {
  seq: number;
  createdAt: string;
};

export type AiUiBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "thinking"; text: string }
  | {
      id: string;
      type: "tool_call";
      callId: string;
      name: string;
      args?: unknown;
      result?: unknown;
      status: "running" | "called" | "completed" | "failed";
    }
  | {
      id: string;
      type: "approval_request";
      request: Extract<AiStreamEvent, { type: "approval_request" }>;
      status: "pending" | "approved" | "rejected";
    }
  | {
      id: string;
      type: "frontend_tool";
      request: Extract<AiStreamEvent, { type: "frontend_tool" }>;
      status: "pending" | "completed" | "failed";
      result?: unknown;
    }
  | { id: string; type: "compaction"; status: "running" | "completed" }
  | { id: string; type: "error"; message: string };

export type AiConversationStore = {
  createConversation(input: {
    appId: string;
    ownerUserId: string;
    title?: string;
    icon?: string;
    description?: string;
    resource?: AiConversationResource;
  }): Promise<AiConversation>;
  listConversations(input: {
    appId: string;
    ownerUserId: string;
    resource?: AiConversationResource;
    search?: string;
    limit?: number;
  }): Promise<AiConversation[]>;
  listConversationsPage(input: {
    appId: string;
    ownerUserId: string;
    resource?: AiConversationResource;
    search?: string;
    page: number;
    perPage: number;
  }): Promise<AiConversationPage>;
  getConversation(input: {
    conversationId: string;
    appId?: string;
    ownerUserId?: string;
    resource?: AiConversationResource;
  }): Promise<AiConversation | null>;
  updateConversationMetadata(input: {
    conversationId: string;
    appId?: string;
    ownerUserId?: string;
    title: string;
    icon?: string;
    description?: string;
  }): Promise<AiConversation | null>;
  archiveConversation(input: { conversationId: string; appId?: string; ownerUserId?: string }): Promise<boolean>;
  listMessages(input: { conversationId: string }): Promise<AiStoredMessage[]>;
  copyMessages(input: { sourceConversationId: string; targetConversationId: string; throughSeq: number }): Promise<void>;
  truncateMessagesFrom(input: { conversationId: string; fromSeq: number }): Promise<void>;
  setLatestAssistantLoopAggregate(input: {
    conversationId: string;
    loopId?: string | null;
    aggregate: LoopAggregate;
    doneReason: DoneReason;
  }): Promise<void>;
  compactMessages(input: {
    conversationId: string;
    checkpointSeq: number;
    summary: Message;
    modelProfileId?: string | null;
  }): Promise<void>;
  createTurn(input: {
    conversationId: string;
    modelProfileId: string;
    leaseOwner?: string;
    leaseMs?: number;
    runConfig?: AiTurnRunConfig;
  }): Promise<AiTurn>;
  getTurn(input: { conversationId: string; turnId: string }): Promise<AiTurn | null>;
  getTurnRunConfig(input: { conversationId: string; turnId: string }): Promise<AiTurnRunConfig | null>;
  getRunningTurn(input: { conversationId: string }): Promise<AiTurn | null>;
  listRecoverableTurns(input?: { limit?: number }): Promise<AiTurn[]>;
  claimTurnLease(input: { conversationId: string; turnId: string; leaseOwner: string; leaseMs: number }): Promise<boolean>;
  heartbeatTurn(input: { conversationId: string; turnId: string; leaseOwner: string; leaseMs: number }): Promise<boolean>;
  expireStaleTurns(input?: { conversationId?: string }): Promise<number>;
  requestTurnAbort(input: { conversationId: string; turnId: string; reason?: string }): Promise<AiTurnAbortResult>;
  isTurnRunning(input: { conversationId: string; turnId: string }): Promise<boolean>;
  isTurnLeaseOwner(input: { conversationId: string; turnId: string; leaseOwner: string }): Promise<boolean>;
  completeTurn(input: {
    turnId: string;
    status: Exclude<AiTurnStatus, "running">;
    error?: string | null;
    leaseOwner?: string;
  }): Promise<void>;
  appendTurnEvent(input: { event: AiStreamEvent }): Promise<AiStoredTurnEvent | null>;
  listTurnEvents(input: { conversationId: string; turnId?: string; after?: string | null; limit?: number }): Promise<AiStoredTurnEvent[]>;
  savePendingTurnAction(input: AiPendingTurnActionRecord): Promise<void>;
  listPendingTurnActions(input: { conversationId: string; turnId: string }): Promise<AiPendingTurnAction[]>;
  getPendingTurnAction(input: { conversationId: string; turnId: string; callId: string }): Promise<AiPendingTurnActionRecord | null>;
  resolvePendingTurnAction(input: {
    conversationId: string;
    turnId: string;
    callId: string;
    event: InboundEvent;
  }): Promise<AiPendingTurnActionRecord | null>;
  clearPendingTurnActions(input: { conversationId: string; turnId: string }): Promise<void>;
  createSessionStore(input: { conversationId: string; modelProfileId?: string | null; turnId?: string | null }): SessionStore;
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
