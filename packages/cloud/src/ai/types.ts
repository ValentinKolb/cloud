import type {
  ContentPart,
  DoneReason,
  InboundEvent,
  Input,
  LoopAggregate,
  Message,
  Provider,
  SessionStore,
  Tool,
  ToolContext,
} from "@valentinkolb/nessi";
import type { Usage } from "@valentinkolb/nessi/ai";
import type { z } from "zod";
import type { RequestActor } from "../server";
import type { AiTurnBlock } from "./protocol";

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
  /** Small logo (data URL, hard-compressed) shown in the admin card and the composer model picker. */
  image?: string;
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
  "id" | "label" | "provider" | "model" | "image" | "capabilities" | "dataBoundary" | "contextWindow"
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
      firecrawlConfigured: boolean;
      profiles: AiModelProfile[];
    }
  | {
      ok: false;
      enabled: boolean;
      defaultModelId: string;
      globalInstructions: string;
      compactionPrompt: string;
      maxToolResultChars: number;
      firecrawlConfigured: boolean;
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

export type AiConversationFieldSource = "default" | "auto" | "user";
export type AiConversationTitleSource = AiConversationFieldSource;

export type AiConversation = {
  id: string;
  appId: string;
  title: string;
  /** Who set the current title — enrichment never overwrites a user-chosen title. */
  titleSource: AiConversationFieldSource;
  icon: string;
  /** User-visible description. Kept fresh by the enrichment job until the user edits it. */
  description: string;
  /** Who wrote the current description — enrichment never overwrites a user-authored one. */
  descriptionSource: AiConversationFieldSource;
  /** AI-generated keywords for search. */
  keywords: string[];
  resource: AiConversationResource;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiEnrichmentRunStatus = "ok" | "failed" | "skipped";
export type AiEnrichmentTrigger = "scheduled" | "manual";

/** One recorded enrichment attempt for a conversation — user-visible in chat settings. */
export type AiEnrichmentRun = {
  id: string;
  conversationId: string;
  status: AiEnrichmentRunStatus;
  trigger: AiEnrichmentTrigger;
  modelProfileId: string | null;
  /** nessi structured mode of the successful call: native | fallback | repair. */
  mode: string | null;
  durationMs: number | null;
  titleUpdated: boolean;
  keywordsCount: number;
  error: string | null;
  createdAt: string;
};

/** Current index state of one conversation, for the chat settings UI. */
export type AiEnrichmentStatus = {
  enrichedAt: string | null;
  /** Content changed since the last enrichment (or never enriched). */
  dirty: boolean;
  enrichFailCount: number;
  /** Current AI-generated search keywords. */
  keywords: string[];
};

export type AiEnrichmentOverviewRun = AiEnrichmentRun & {
  conversationTitle: string;
  appId: string;
};

export type AiEnrichmentOverview = {
  totalConversations: number;
  dirtyConversations: number;
  failedConversations: number;
  oldestDirtyAt: string | null;
  lastRunAt: string | null;
  avgDurationMs: number | null;
  failedRuns24h: number;
  totalRuns24h: number;
  errorRate24h: number;
  recentRuns: AiEnrichmentOverviewRun[];
};

export type AiEnrichmentCandidate = AiConversation & {
  /**
   * The conversation's updated_at exactly as stored (Postgres microsecond
   * precision, via ::text). Written back as enriched_at — the ISO `updatedAt`
   * field is millisecond-truncated and would leave the chat dirty forever.
   */
  dirtyAsOf: string;
  /** Consecutive failed enrichment attempts (drives the retry backoff). */
  enrichFailCount: number;
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
  /**
   * Set once compaction archived this message out of the model context.
   * Archived messages stay visible in the chat; only the model stops seeing them.
   */
  compactedAt: string | null;
  /** UI metadata (e.g. how many messages a compaction summary replaced). */
  meta: { compactedCount?: number; steerId?: string } | null;
  createdAt: string;
};

export type AiTurnStatus = "queued" | "running" | "waiting_for_action" | "completed" | "failed" | "aborted";

export type AiTurnSteerStatus = "pending" | "consumed" | "discarded";

export type AiTurnSteer = {
  id: string;
  conversationId: string;
  turnId: string;
  seq: number;
  clientRequestId: string;
  text: string;
  status: AiTurnSteerStatus;
  messageId: string | null;
  createdAt: string;
  consumedAt: string | null;
};

export type AiTurnSteerEnqueueResult = { ok: true; steer: AiTurnSteer } | { ok: false; reason: "not_found" | "not_chat" | "not_active" };

export type AiTurnCompletionResult = "completed" | "pending_steering" | "lost";

export type AiTurn = {
  id: string;
  conversationId: string;
  status: AiTurnStatus;
  attempt: number;
  modelProfileId: string | null;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};

export type AiPendingTurnAction =
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
    };

export type AiTurnAbortRequest =
  | { found: false }
  | {
      found: true;
      status: AiTurnStatus;
      /** True when no live lease exists — the caller must finalize the turn itself. */
      ownerless: boolean;
    };

export type AiPendingTurnActionRecord = {
  turnId: string;
  conversationId: string;
  callId: string;
  kind: "approval" | "custom_approval" | "client_tool";
  status: "pending" | "resolved" | "aborted";
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

export type AiChatTurnRunConfig = {
  kind?: "chat";
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

export type AiCompactionTurnRunConfig = {
  kind: "compact";
  actor?: RequestActor;
  modelPolicy?: AiModelPolicy;
  requestedModelId?: string;
};

export type AiTurnRunConfig = AiChatTurnRunConfig | AiCompactionTurnRunConfig;

export type AiTurnClaim = {
  turn: AiTurn;
  runConfig: AiTurnRunConfig | null;
  /** Live blocks persisted by a previous attempt (continuation base), if any. */
  liveBlocks: AiTurnBlock[] | null;
  /** Highest wire seq of the previous attempt; the new attempt continues from here. */
  liveSeq: number;
};

export type AiTurnSweepAction = { conversationId: string; turnId: string };
/** A turn finalized by the sweep, with the wire coordinates for its turn_finished event. */
export type AiTurnFinalizedAction = AiTurnSweepAction & { attempt: number; seq: number };

export type AiTurnSweepResult = {
  /** Lease-expired or stale-queued turns that need (re-)enqueueing. */
  requeued: AiTurnSweepAction[];
  /** Turns finalized as failed (deadline exceeded); turn_finished must be published. */
  failed: (AiTurnFinalizedAction & { error: string })[];
  /** Turns finalized as aborted (cancel requested or waiting deadline); turn_finished must be published. */
  aborted: AiTurnFinalizedAction[];
};

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
  /**
   * Conversations whose content changed since the last enrichment (no active
   * turn, has messages, failure backoff elapsed). Oldest first. With
   * `conversationId` (manual reindex) the dirty and backoff checks are skipped.
   */
  listEnrichmentCandidates(input: { limit: number; conversationId?: string }): Promise<AiEnrichmentCandidate[]>;
  /**
   * Store enrichment results and clear the failure backoff. `dirtyAsOf` is the
   * candidate's exact scan-time updated_at (microsecond precision) — enriched_at
   * is set to it, so activity during the run keeps the chat dirty while an
   * unchanged chat becomes exactly clean (updated_at = enriched_at).
   * `description`/`title` are omitted when the current value is user-authored.
   */
  applyEnrichment(input: {
    conversationId: string;
    description?: string;
    keywords: string[];
    title?: string;
    dirtyAsOf: string;
  }): Promise<void>;
  /** Record a failed enrichment attempt — the candidate query backs the chat off exponentially. */
  markEnrichmentFailed(input: { conversationId: string }): Promise<void>;
  /** Append one run to the user-visible enrichment history (keeps the newest 20 per conversation). */
  recordEnrichmentRun(input: {
    conversationId: string;
    status: AiEnrichmentRunStatus;
    trigger: AiEnrichmentTrigger;
    modelProfileId?: string;
    mode?: string;
    durationMs?: number;
    titleUpdated?: boolean;
    keywordsCount?: number;
    error?: string;
  }): Promise<void>;
  listEnrichmentRuns(input: { conversationId: string; limit?: number }): Promise<AiEnrichmentRun[]>;
  getEnrichmentStatus(input: { conversationId: string }): Promise<AiEnrichmentStatus | null>;
  getEnrichmentOverview(): Promise<AiEnrichmentOverview>;
  /** Chat history for humans: includes compacted messages, hides superseded summaries. */
  listMessages(input: { conversationId: string }): Promise<AiStoredMessage[]>;
  /**
   * Newest window of the human view for infinite scroll. `beforeSeq` pages
   * older history (exclusive). Whole seq groups are always returned together
   * (compaction can put several rows on one seq), so the cursor
   * `min(seq) of the page` never skips rows.
   */
  listMessagesPage(input: { conversationId: string; beforeSeq?: number; limit?: number }): Promise<{
    messages: AiStoredMessage[];
    hasMore: boolean;
  }>;
  /** Model context: only active (non-compacted) messages — what the LLM sees. */
  listContextMessages(input: { conversationId: string }): Promise<AiStoredMessage[]>;
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
  listTurnMessages(input: { conversationId: string; loopId: string }): Promise<AiStoredMessage[]>;
  createTurn(input: { conversationId: string; modelProfileId: string; runConfig?: AiTurnRunConfig }): Promise<AiTurn>;
  /** Persist the user message and create its turn in one transaction. */
  submitChatTurn(input: {
    conversationId: string;
    modelProfileId: string;
    runConfig: AiTurnRunConfig;
    userMessage: Message;
    /** Delete active messages with seq >= truncateFromSeq first (retry-in-place). */
    truncateFromSeq?: number;
  }): Promise<{ turn: AiTurn; message: AiStoredMessage }>;
  getTurn(input: { conversationId: string; turnId: string }): Promise<AiTurn | null>;
  getActiveTurn(input: { conversationId: string }): Promise<{ turn: AiTurn; liveBlocks: AiTurnBlock[]; liveSeq: number } | null>;
  /**
   * Claim a turn attempt. Increments attempt and takes the lease atomically.
   * `from: "queue"` claims queued or lease-expired running turns; `from: "waiting"`
   * claims suspended turns that have at least one resolved pending action.
   */
  claimTurn(input: {
    conversationId: string;
    turnId: string;
    leaseOwner: string;
    leaseMs: number;
    from: "queue" | "waiting";
    maxAttempts: number;
    runBudgetMs: number;
  }): Promise<AiTurnClaim | null>;
  heartbeatTurn(input: { conversationId: string; turnId: string; leaseOwner: string; leaseMs: number }): Promise<boolean>;
  /** Release the worker: persist live state, drop the lease, park the turn until its actions resolve. */
  suspendTurn(input: {
    conversationId: string;
    turnId: string;
    leaseOwner: string;
    blocks: AiTurnBlock[];
    seq: number;
    waitingBudgetMs: number;
  }): Promise<boolean>;
  saveTurnLiveState(input: {
    conversationId: string;
    turnId: string;
    leaseOwner: string;
    blocks: AiTurnBlock[];
    seq: number;
  }): Promise<boolean>;
  /** Record an abort wish. The caller finalizes ownerless turns itself. */
  requestTurnAbort(input: { conversationId: string; turnId: string; reason?: string }): Promise<AiTurnAbortRequest>;
  completeTurn(input: {
    conversationId: string;
    turnId: string;
    status: "completed" | "failed" | "aborted";
    error?: string | null;
    /** When set, only the lease owner may finalize; otherwise only ownerless turns are finalized. */
    leaseOwner?: string;
  }): Promise<AiTurnCompletionResult>;
  /** Periodic maintenance: requeue lost turns, fail over-budget turns, abort stale waits. */
  sweepTurns(input?: { limit?: number }): Promise<AiTurnSweepResult>;
  savePendingTurnAction(input: AiPendingTurnActionRecord): Promise<void>;
  listPendingTurnActions(input: { conversationId: string; turnId: string }): Promise<AiPendingTurnAction[]>;
  getPendingTurnAction(input: { conversationId: string; turnId: string; callId: string }): Promise<AiPendingTurnActionRecord | null>;
  listPendingActionRecords(input: { conversationId: string; turnId: string }): Promise<AiPendingTurnActionRecord[]>;
  listResolvedPendingActions(input: { conversationId: string; turnId: string }): Promise<AiPendingTurnActionRecord[]>;
  resolvePendingTurnAction(input: {
    conversationId: string;
    turnId: string;
    callId: string;
    event: InboundEvent;
  }): Promise<AiPendingTurnActionRecord | null>;
  clearPendingTurnActions(input: { conversationId: string; turnId: string }): Promise<void>;
  enqueueTurnSteer(input: {
    conversationId: string;
    turnId: string;
    clientRequestId: string;
    text: string;
  }): Promise<AiTurnSteerEnqueueResult>;
  listTurnSteers(input: { conversationId: string; turnId: string }): Promise<AiTurnSteer[]>;
  /** Atomically make pending steers visible to the model and return them in order. */
  takePendingTurnSteers(input: { conversationId: string; turnId: string; leaseOwner: string }): Promise<AiTurnSteer[]>;
  createSessionStore(input: {
    conversationId: string;
    modelProfileId?: string | null;
    turnId?: string | null;
    leaseOwner?: string | null;
  }): SessionStore;
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
  /** Per-tool execution timeout enforced by nessi. */
  timeoutMs?: number;
  /** One-line "when to use" hint listed in the system prompt's Tools section. Tools without a hint are not listed. */
  promptHint?: string;
  /** Optional compact representation sent to providers in later loops. The full result remains persisted and visible. */
  toHistoricalResult?: (context: { input: z.infer<TInput>; output: z.infer<TOutput>; callId: string }) => unknown | Promise<unknown>;
};

export type AiToolRuntime<TInput extends z.ZodType = z.ZodType, TOutput extends z.ZodType = z.ZodType> =
  | {
      location: "server";
      def: AiToolDefinition<TInput, TOutput>;
      run(input: z.infer<TInput>, ctx: ToolContext & { actor: RequestActor; conversationId?: string }): Promise<z.infer<TOutput>>;
    }
  | {
      location: AiFrontendToolMode;
      def: AiToolDefinition<TInput, TOutput>;
    };

export type AiRuntimeTool = Tool | AiToolRuntime;
