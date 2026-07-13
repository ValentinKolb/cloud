import { z } from "zod";

export const connectionPolicySchema = z.enum(["shared_connection", "personal_provider_account"]);
export type ConnectionPolicy = z.infer<typeof connectionPolicySchema>;

export const searchBackendSchema = z.enum(["auto", "postgres", "pg_textsearch"]);
export type SearchBackend = z.infer<typeof searchBackendSchema>;

export const mailboxHealthSchema = z.enum([
  "disconnected",
  "verifying",
  "bootstrapping",
  "active",
  "auth_required",
  "degraded",
  "reconnecting",
  "connection_required",
  "paused",
]);
export type MailboxHealth = z.infer<typeof mailboxHealthSchema>;

export const connectorKindSchema = z.literal("imap_smtp");
export type ConnectorKind = z.infer<typeof connectorKindSchema>;

export const tlsModeSchema = z.enum(["implicit", "starttls"]);
export type TlsMode = z.infer<typeof tlsModeSchema>;

export const connectionOwnerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mailbox"), mailboxId: z.string().uuid() }),
  z.object({ type: z.literal("user"), userId: z.string().uuid() }),
  z.object({ type: z.literal("service_account"), serviceAccountId: z.string().uuid() }),
]);
export type ConnectionOwner = z.infer<typeof connectionOwnerSchema>;

export const endpointSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  tlsMode: tlsModeSchema,
});
export type MailEndpoint = z.infer<typeof endpointSchema>;

export const providerSecretSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("password"), password: z.string().min(1).max(16_384) }),
  z.object({
    kind: z.literal("oauth2"),
    accessToken: z.string().min(1).max(65_536),
    refreshToken: z.string().min(1).max(65_536).optional(),
    expiresAt: z.string().datetime().optional(),
  }),
]);
export type ProviderSecret = z.infer<typeof providerSecretSchema>;

export const providerConnectionInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(320),
  username: z.string().trim().min(1).max(320),
  imap: endpointSchema,
  smtp: endpointSchema,
  secret: providerSecretSchema,
});
export type ProviderConnectionInput = z.infer<typeof providerConnectionInputSchema>;

export const providerConnectionSchema = z.object({
  id: z.string().uuid(),
  owner: connectionOwnerSchema,
  name: z.string(),
  email: z.string(),
  username: z.string(),
  connectorKind: connectorKindSchema,
  imap: endpointSchema,
  smtp: endpointSchema,
  secret: z.object({ kind: z.enum(["password", "oauth2"]), isSet: z.boolean() }),
  status: z.enum(["active", "degraded", "revoked"]),
  authenticatedPrincipal: z.string().nullable(),
  lastVerifiedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;

export const mailboxSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  connectionPolicy: connectionPolicySchema,
  health: mailboxHealthSchema,
  healthReason: z.string().nullable(),
  syncEnabled: z.boolean(),
  searchBackend: searchBackendSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Mailbox = z.infer<typeof mailboxSchema>;

const lifecycleCountsSchema = z.record(z.string(), z.number().int().nonnegative());

export const mailboxOperationalHealthSchema = z.object({
  mailboxId: z.string().uuid(),
  health: mailboxHealthSchema,
  healthReason: z.string().nullable(),
  syncEnabled: z.boolean(),
  bindings: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    degraded: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    revoked: z.number().int().nonnegative(),
    lastVerifiedAt: z.string().datetime().nullable(),
    rightsSources: lifecycleCountsSchema,
  }),
  discovery: z.object({
    generation: z.number().int().nonnegative(),
    lastAt: z.string().datetime().nullable(),
    activeFolders: z.number().int().nonnegative(),
    missingFolders: z.number().int().nonnegative(),
    ambiguousFolders: z.number().int().nonnegative(),
    subscribedFolders: z.number().int().nonnegative(),
  }),
  sync: z.object({
    lastAt: z.string().datetime().nullable(),
    lagSeconds: z.number().int().nonnegative().nullable(),
    runningRuns: z.number().int().nonnegative(),
    failedRuns: z.number().int().nonnegative(),
    folderStates: lifecycleCountsSchema,
  }),
  hydration: z.object({
    complete: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  commands: z.object({
    states: lifecycleCountsSchema,
    maintenanceQueued: z.number().int().nonnegative(),
  }),
  outbox: z.object({ states: lifecycleCountsSchema }),
  search: z.object({
    configuredBackend: searchBackendSchema,
    pgTextsearchInstalled: z.boolean(),
    bm25Ready: z.boolean(),
  }),
});
export type MailboxOperationalHealth = z.infer<typeof mailboxOperationalHealthSchema>;

export const createMailboxInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).nullable().optional(),
  connectionPolicy: connectionPolicySchema.default("shared_connection"),
});
export type CreateMailboxInput = z.infer<typeof createMailboxInputSchema>;

export const bindingStateSchema = z.enum(["pending", "verifying", "active", "degraded", "revoked"]);
export type BindingState = z.infer<typeof bindingStateSchema>;

export const providerBindingSchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid(),
  connectionId: z.string().uuid(),
  state: bindingStateSchema,
  authenticatedPrincipal: z.string().nullable(),
  rootPath: z.string(),
  capabilities: z.record(z.string(), z.unknown()),
  lastVerifiedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProviderBinding = z.infer<typeof providerBindingSchema>;

export const folderRoleSchema = z.enum(["inbox", "sent", "drafts", "trash", "archive", "junk", "all", "other"]);
export type FolderRole = z.infer<typeof folderRoleSchema>;

export const folderRightsSourceSchema = z.enum(["acl", "select", "probe", "unknown"]);
export type FolderRightsSource = z.infer<typeof folderRightsSourceSchema>;

export const configurableFolderRoleSchema = z.enum(["sent", "drafts", "trash", "archive", "junk"]);
export type ConfigurableFolderRole = z.infer<typeof configurableFolderRoleSchema>;

export const standardMessageFlagSchema = z.enum(["seen", "answered", "flagged", "draft"]);
export type StandardMessageFlag = z.infer<typeof standardMessageFlagSchema>;

export const addressRoleSchema = z.enum(["from", "reply_to", "to", "cc", "bcc"]);
export type AddressRole = z.infer<typeof addressRoleSchema>;

export const mailSearchFieldSchema = z.enum(["any", "subject", "body", "from", "to", "cc", "bcc", "message_id"]);
export type MailSearchField = z.infer<typeof mailSearchFieldSchema>;

export const mailSearchTermSchema = z.object({
  field: mailSearchFieldSchema,
  query: z.string().trim().min(1).max(500),
  match: z.enum(["words", "phrase", "contains", "exact"]).default("words"),
});

export type MailSearchExpression =
  | z.infer<typeof mailSearchTermSchema>
  | { and: MailSearchExpression[] }
  | { or: MailSearchExpression[] }
  | { not: MailSearchExpression };

export const mailSearchExpressionSchema: z.ZodType<MailSearchExpression> = z.lazy(() =>
  z.union([
    mailSearchTermSchema,
    z.object({ and: z.array(mailSearchExpressionSchema).min(1).max(20) }).strict(),
    z.object({ or: z.array(mailSearchExpressionSchema).min(1).max(20) }).strict(),
    z.object({ not: mailSearchExpressionSchema }).strict(),
  ]),
);

export const searchRequestSchema = z.object({
  expression: mailSearchExpressionSchema,
  sort: z.enum(["relevance", "newest"]).default("relevance"),
  cursor: z.string().max(2_000).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export const mailExecutionOperationSchema = z.enum(["backgroundSync", "actorRead", "actorMutation", "actorSend", "automation"]);
export type MailExecutionOperation = z.infer<typeof mailExecutionOperationSchema>;

export const commandKindSchema = z.enum([
  "set_flags",
  "change_message_state",
  "move",
  "copy",
  "delete",
  "create_folder",
  "rename_folder",
  "delete_folder",
  "set_folder_subscription",
  "send",
  "sync_mailbox",
  "sync_folder",
  "discover_folders",
  "verify_binding",
  "rebuild_folder",
  "hydrate_missing",
]);
export type CommandKind = z.infer<typeof commandKindSchema>;

export const commandStateSchema = z.enum([
  "queued",
  "executing",
  "confirmed",
  "failed",
  "cancelled",
  "ambiguous",
  "reconciled",
  "needs_attention",
]);
export type CommandState = z.infer<typeof commandStateSchema>;

const actorCommandBaseSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  correlationId: z.string().trim().max(200).optional(),
});

export const mailKeywordSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !value.startsWith("\\"), "Keywords cannot use the IMAP system-flag namespace")
  .refine((value) => !/[\u0000-\u001f\u007f()\{\s]/.test(value), "Keyword contains unsupported IMAP characters");

const folderLeafNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\u0000\r\n]/.test(value), "Folder name contains unsupported characters");

export const messageStateChangeSchema = z
  .object({
    addFlags: z.array(standardMessageFlagSchema).max(4).default([]),
    removeFlags: z.array(standardMessageFlagSchema).max(4).default([]),
    addKeywords: z.array(mailKeywordSchema).max(100).default([]),
    removeKeywords: z.array(mailKeywordSchema).max(100).default([]),
  })
  .superRefine((value, context) => {
    const additions = new Set([
      ...value.addFlags.map((flag) => `flag:${flag}`),
      ...value.addKeywords.map((keyword) => `keyword:${keyword.toLowerCase()}`),
    ]);
    const removals = new Set([
      ...value.removeFlags.map((flag) => `flag:${flag}`),
      ...value.removeKeywords.map((keyword) => `keyword:${keyword.toLowerCase()}`),
    ]);
    if (additions.size + removals.size === 0) {
      context.addIssue({ code: "custom", message: "At least one state change is required" });
    }
    for (const item of additions) {
      if (removals.has(item)) {
        context.addIssue({ code: "custom", message: `Cannot add and remove ${item.slice(item.indexOf(":") + 1)} in one command` });
      }
    }
  });
export type MessageStateChange = z.infer<typeof messageStateChangeSchema>;

export const conversationTriageInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("change_state"),
    sourceFolderId: z.string().uuid(),
    change: messageStateChangeSchema,
    idempotencyKey: z.string().trim().min(1).max(150),
    correlationId: z.string().trim().max(200).optional(),
  }),
  z.object({
    kind: z.literal("move_to_role"),
    sourceFolderId: z.string().uuid(),
    role: z.enum(["archive", "trash", "junk"]),
    idempotencyKey: z.string().trim().min(1).max(150),
    correlationId: z.string().trim().max(200).optional(),
  }),
]);
export type ConversationTriageInput = z.infer<typeof conversationTriageInputSchema>;

export const actorCommandInputSchema = z.discriminatedUnion("kind", [
  actorCommandBaseSchema.extend({
    kind: z.literal("set_flags"),
    remoteMessageRefId: z.string().uuid(),
    folderId: z.string().uuid(),
    flags: z.array(z.string().trim().min(1).max(100)).max(100),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("change_message_state"),
    remoteMessageRefId: z.string().uuid(),
    folderId: z.string().uuid(),
    change: messageStateChangeSchema,
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("move"),
    remoteMessageRefId: z.string().uuid(),
    sourceFolderId: z.string().uuid(),
    destinationFolderId: z.string().uuid(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("copy"),
    remoteMessageRefId: z.string().uuid(),
    sourceFolderId: z.string().uuid(),
    destinationFolderId: z.string().uuid(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("delete"),
    remoteMessageRefId: z.string().uuid(),
    folderId: z.string().uuid(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("create_folder"),
    parentFolderId: z.string().uuid().nullable().optional(),
    name: folderLeafNameSchema,
    subscribe: z.boolean().default(true),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("rename_folder"),
    folderId: z.string().uuid(),
    name: folderLeafNameSchema,
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("delete_folder"),
    folderId: z.string().uuid(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("set_folder_subscription"),
    folderId: z.string().uuid(),
    subscribed: z.boolean(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("send"),
    draftId: z.string().uuid(),
    senderIdentityId: z.string().uuid(),
    scheduledAt: z.string().datetime().optional(),
    undoSeconds: z.number().int().min(0).max(60).default(10),
  }),
]);
export type ActorCommandInput = z.infer<typeof actorCommandInputSchema>;

export const maintenanceCommandInputSchema = z.discriminatedUnion("kind", [
  actorCommandBaseSchema.extend({ kind: z.literal("sync_mailbox") }),
  actorCommandBaseSchema.extend({ kind: z.literal("sync_folder"), folderId: z.string().uuid() }),
  actorCommandBaseSchema.extend({ kind: z.literal("discover_folders"), bindingId: z.string().uuid().optional() }),
  actorCommandBaseSchema.extend({ kind: z.literal("verify_binding"), bindingId: z.string().uuid() }),
  actorCommandBaseSchema.extend({ kind: z.literal("rebuild_folder"), folderId: z.string().uuid() }),
  actorCommandBaseSchema.extend({ kind: z.literal("hydrate_missing") }),
]);
export type MaintenanceCommandInput = z.infer<typeof maintenanceCommandInputSchema>;

export const mailCommandInputSchema = z.union([actorCommandInputSchema, maintenanceCommandInputSchema]);
export type MailCommandInput = z.infer<typeof mailCommandInputSchema>;

export const mailCommandSchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid(),
  kind: commandKindSchema,
  state: commandStateSchema,
  actor: z.lazy(() => actorRefSchema),
  idempotencyKey: z.string(),
  correlationId: z.string().nullable(),
  target: z.record(z.string(), z.unknown()),
  payload: z.record(z.string(), z.unknown()),
  selectedBindingId: z.string().uuid().nullable(),
  rightsSnapshot: z.record(z.string(), z.unknown()).nullable(),
  transportMetadata: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()),
  attempt: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MailCommand = z.infer<typeof mailCommandSchema>;

export const actorRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.string().uuid() }),
  z.object({ kind: z.literal("service_account"), serviceAccountId: z.string().uuid(), delegatedUserId: z.string().uuid().nullable() }),
  z.object({ kind: z.literal("workflow"), workflowVersionId: z.string().uuid() }),
  z.object({ kind: z.literal("system") }),
]);
export type ActorRef = z.infer<typeof actorRefSchema>;

export const conversationWorkStatusSchema = z.enum(["open", "waiting", "done"]);
export type ConversationWorkStatus = z.infer<typeof conversationWorkStatusSchema>;

const workflowTextConditionSchema = z
  .object({
    field: z.enum(["subject", "body", "sender", "recipient", "attachmentName"]),
    operator: z.enum(["contains", "equals", "startsWith", "endsWith"]),
    value: z.string().min(1).max(500),
  })
  .strict();

const workflowFolderConditionSchema = z
  .object({
    field: z.literal("folder"),
    operator: z.literal("equals"),
    value: z.string().uuid(),
  })
  .strict();

const workflowKeywordConditionSchema = z
  .object({
    field: z.literal("keyword"),
    operator: z.literal("contains"),
    value: mailKeywordSchema,
  })
  .strict();

const workflowFlagConditionSchema = z
  .object({
    field: z.literal("flag"),
    operator: z.literal("contains"),
    value: standardMessageFlagSchema,
  })
  .strict();

const workflowAttachmentConditionSchema = z
  .object({
    field: z.literal("hasAttachment"),
    operator: z.literal("equals"),
    value: z.boolean(),
  })
  .strict();

export type WorkflowCondition =
  | z.infer<typeof workflowTextConditionSchema>
  | z.infer<typeof workflowFolderConditionSchema>
  | z.infer<typeof workflowKeywordConditionSchema>
  | z.infer<typeof workflowFlagConditionSchema>
  | z.infer<typeof workflowAttachmentConditionSchema>
  | { all: WorkflowCondition[] }
  | { any: WorkflowCondition[] }
  | { not: WorkflowCondition };

export const workflowConditionSchema: z.ZodType<WorkflowCondition> = z.lazy(() =>
  z.union([
    workflowTextConditionSchema,
    workflowFolderConditionSchema,
    workflowKeywordConditionSchema,
    workflowFlagConditionSchema,
    workflowAttachmentConditionSchema,
    z.object({ all: z.array(workflowConditionSchema).min(1).max(20) }).strict(),
    z.object({ any: z.array(workflowConditionSchema).min(1).max(20) }).strict(),
    z.object({ not: workflowConditionSchema }).strict(),
  ]),
);

export const workflowActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("remote.keyword.add"), keyword: mailKeywordSchema }).strict(),
  z.object({ action: z.literal("remote.keyword.remove"), keyword: mailKeywordSchema }).strict(),
  z.object({ action: z.literal("remote.move"), destinationFolderId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("assign"), userId: z.string().uuid().nullable() }).strict(),
  z.object({ action: z.literal("status.set"), status: conversationWorkStatusSchema }).strict(),
]);
export type WorkflowAction = z.infer<typeof workflowActionSchema>;

export type WorkflowStep =
  | { when: WorkflowCondition; then: WorkflowStep[]; else?: WorkflowStep[] }
  | WorkflowAction
  | { stop: "workflow" };

export const workflowStepSchema: z.ZodType<WorkflowStep> = z.lazy(() =>
  z.union([
    z
      .object({
        when: workflowConditionSchema,
        then: z.array(workflowStepSchema).min(1).max(50),
        else: z.array(workflowStepSchema).min(1).max(50).optional(),
      })
      .strict(),
    workflowActionSchema,
    z.object({ stop: z.literal("workflow") }).strict(),
  ]),
);

export const workflowEffectBudgetSchema = z
  .object({
    maxTargets: z.number().int().min(1).max(50_000).default(1_000),
    maxMoves: z.number().int().min(0).max(50_000).default(1_000),
    maxKeywordChanges: z.number().int().min(0).max(100_000).default(2_000),
    maxCollaborationChanges: z.number().int().min(0).max(100_000).default(2_000),
  })
  .strict()
  .default({
    maxTargets: 1_000,
    maxMoves: 1_000,
    maxKeywordChanges: 2_000,
    maxCollaborationChanges: 2_000,
  });
export type WorkflowEffectBudget = z.infer<typeof workflowEffectBudgetSchema>;

export const workflowDefinitionSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2_000).nullable().optional(),
    priority: z.number().int().min(-1_000).max(1_000).default(100),
    trigger: z.object({ type: z.enum(["manual", "backfill"]) }).strict(),
    effectBudget: workflowEffectBudgetSchema,
    steps: z.array(workflowStepSchema).min(1).max(50),
  })
  .strict();
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const workflowTargetQuerySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }).strict(),
  z.object({ type: z.literal("search"), expression: mailSearchExpressionSchema }).strict(),
]);
export type WorkflowTargetQuery = z.infer<typeof workflowTargetQuerySchema>;

export const workflowPreviewInputSchema = z
  .object({ definition: workflowDefinitionSchema, query: workflowTargetQuerySchema })
  .strict();
export type WorkflowPreviewInput = z.infer<typeof workflowPreviewInputSchema>;

export const createWorkflowInputSchema = z.object({ definition: workflowDefinitionSchema }).strict();
export const createWorkflowVersionInputSchema = z.object({ definition: workflowDefinitionSchema }).strict();

const workflowRunBaseSchema = z.object({
  query: workflowTargetQuerySchema,
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const createOneShotWorkflowRunInputSchema = workflowRunBaseSchema
  .extend({ definition: workflowDefinitionSchema })
  .strict();
export type CreateOneShotWorkflowRunInput = z.infer<typeof createOneShotWorkflowRunInputSchema>;

export const createSavedWorkflowRunInputSchema = workflowRunBaseSchema
  .extend({ version: z.number().int().positive().optional() })
  .strict();
export type CreateSavedWorkflowRunInput = z.infer<typeof createSavedWorkflowRunInputSchema>;

export const workflowRunStateSchema = z.enum([
  "queued",
  "running",
  "waiting_command",
  "succeeded",
  "failed",
  "canceled",
  "needs_attention",
]);
export type WorkflowRunState = z.infer<typeof workflowRunStateSchema>;

export type WorkflowDiagnostic = {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
};

export type WorkflowValidation = {
  valid: boolean;
  definition: WorkflowDefinition | null;
  definitionHash: string | null;
  diagnostics: WorkflowDiagnostic[];
};

export type WorkflowPreview = {
  validation: WorkflowValidation;
  queryHash: string;
  previewHash: string | null;
  targetCount: number;
  actionTargetCount: number;
  waitingDataCount: number;
  truncated: boolean;
  budgetExceeded: boolean;
  actionCounts: Record<string, number>;
  samples: Array<{
    messageId: string;
    conversationId: string | null;
    subject: string;
    state: "ready" | "waiting_data";
    actions: Array<{ path: string; action: WorkflowAction }>;
  }>;
};

export type MailWorkflow = {
  id: string;
  mailboxId: string;
  lifecycle: "saved" | "one_shot";
  name: string;
  description: string | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type MailWorkflowVersion = {
  id: string;
  workflowId: string;
  mailboxId: string;
  version: number;
  definition: WorkflowDefinition;
  definitionHash: string;
  createdAt: string;
};

export type MailWorkflowDetail = MailWorkflow & { version: MailWorkflowVersion };

export type MailWorkflowRun = {
  id: string;
  mailboxId: string;
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  triggerType: "manual" | "backfill";
  state: WorkflowRunState;
  query: WorkflowTargetQuery;
  previewHash: string;
  targetCount: number;
  actionTargetCount: number;
  completedTargets: number;
  failedTargets: number;
  actionCounts: Record<string, number>;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export const conversationViewSchema = z.enum(["inbox", "mine", "unassigned", "waiting", "done", "snoozed", "recently_active"]);
export type ConversationView = z.infer<typeof conversationViewSchema>;

export const updateConversationCollaborationSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    assigneeUserId: z.string().uuid().nullable().optional(),
    workStatus: conversationWorkStatusSchema.optional(),
    responseNeeded: z.boolean().optional(),
    snoozedUntil: z.string().datetime().nullable().optional(),
  })
  .refine(
    (value) =>
      value.assigneeUserId !== undefined ||
      value.workStatus !== undefined ||
      value.responseNeeded !== undefined ||
      value.snoozedUntil !== undefined,
    "At least one collaboration field is required",
  );
export type UpdateConversationCollaboration = z.infer<typeof updateConversationCollaborationSchema>;

const mentionUserIdsSchema = z
  .array(z.string().uuid())
  .max(50)
  .default([])
  .refine((ids) => new Set(ids).size === ids.length, "Mentioned users must be unique");

const internalCommentBodySchema = z
  .string()
  .min(1)
  .max(50_000)
  .refine((body) => body.trim().length > 0, "Comment cannot be blank");

export const createConversationCommentSchema = z.object({
  body: internalCommentBodySchema,
  parentCommentId: z.string().uuid().nullable().optional(),
  referencedMessageId: z.string().uuid().nullable().optional(),
  mentionUserIds: mentionUserIdsSchema,
});
export type CreateConversationComment = z.infer<typeof createConversationCommentSchema>;

export const updateConversationCommentSchema = z.object({
  expectedRevision: z.number().int().positive(),
  body: internalCommentBodySchema,
  mentionUserIds: mentionUserIdsSchema,
});
export type UpdateConversationComment = z.infer<typeof updateConversationCommentSchema>;

export const deleteConversationCommentSchema = z.object({
  expectedRevision: z.number().int().positive(),
});
export type DeleteConversationComment = z.infer<typeof deleteConversationCommentSchema>;

export const senderAuthenticationPolicySchema = z.object({
  interactive: z.enum(["mailbox", "actor"]),
  automation: z.enum(["disabled", "mailbox", "pool"]),
});
export type SenderAuthenticationPolicy = z.infer<typeof senderAuthenticationPolicySchema>;

export const senderIdentitySchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid(),
  displayName: z.string(),
  fromAddress: z.string().email(),
  replyTo: z.string().email().nullable(),
  envelopeSender: z.string().email().nullable(),
  authenticationPolicy: senderAuthenticationPolicySchema,
  sentFolderId: z.string().uuid().nullable(),
  draftsFolderId: z.string().uuid().nullable(),
  isDefault: z.boolean(),
  status: z.enum(["unverified", "verified", "rejected", "disabled"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SenderIdentity = z.infer<typeof senderIdentitySchema>;

export const createSenderIdentityInputSchema = z.object({
  displayName: z.string().trim().max(200).default(""),
  fromAddress: z.string().email().max(320),
  replyTo: z.string().email().max(320).nullable().optional(),
  envelopeSender: z.string().email().max(320).nullable().optional(),
  authenticationPolicy: senderAuthenticationPolicySchema.default({ interactive: "mailbox", automation: "disabled" }),
  sentFolderId: z.string().uuid().nullable().optional(),
  draftsFolderId: z.string().uuid().nullable().optional(),
  isDefault: z.boolean().optional(),
});
export type CreateSenderIdentityInput = z.infer<typeof createSenderIdentityInputSchema>;

export const updateSenderIdentityInputSchema = createSenderIdentityInputSchema
  .omit({ fromAddress: true })
  .extend({
    displayName: z.string().trim().max(200).optional(),
    fromAddress: z.string().email().max(320).optional(),
    authenticationPolicy: senderAuthenticationPolicySchema.optional(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one sender identity field is required");
export type UpdateSenderIdentityInput = z.infer<typeof updateSenderIdentityInputSchema>;

export const defaultSenderSetupInputSchema = z.object({
  bindingId: z.string().uuid(),
  displayName: z.string().trim().max(200).optional(),
  savesSentAutomatically: z.boolean().default(false),
});
export type DefaultSenderSetupInput = z.infer<typeof defaultSenderSetupInputSchema>;

export const mailAddressSchema = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  address: z.string().email().max(320),
});
export type MailAddress = z.infer<typeof mailAddressSchema>;

export const draftAttachmentSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  contentType: z.string(),
  byteLength: z.number().int().nonnegative(),
  contentHash: z.string().length(64),
  position: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type DraftAttachment = z.infer<typeof draftAttachmentSchema>;

export const draftSchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid(),
  conversationId: z.string().uuid().nullable(),
  senderIdentityId: z.string().uuid(),
  to: z.array(mailAddressSchema),
  cc: z.array(mailAddressSchema),
  bcc: z.array(mailAddressSchema),
  subject: z.string(),
  body: z.string(),
  format: z.enum(["plain", "markdown"]),
  attachments: z.array(draftAttachmentSchema),
  revision: z.number().int().positive(),
  state: z.enum(["draft", "scheduled", "sending", "sent", "discarded"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MailDraft = z.infer<typeof draftSchema>;

export const draftContentInputSchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  senderIdentityId: z.string().uuid(),
  to: z.array(mailAddressSchema).max(200).default([]),
  cc: z.array(mailAddressSchema).max(200).default([]),
  bcc: z.array(mailAddressSchema).max(200).default([]),
  subject: z.string().max(998).default(""),
  body: z
    .string()
    .max(2 * 1024 * 1024)
    .default(""),
  format: z.enum(["plain", "markdown"]).default("markdown"),
});
export type DraftContentInput = z.infer<typeof draftContentInputSchema>;

export type RemoteAccount = {
  id: string;
  name: string;
  locator: Record<string, unknown>;
  namespaces: RemoteNamespace[];
};

export type RemoteNamespace = {
  kind: "personal" | "other_users" | "shared";
  prefix: string;
  delimiter: string | null;
};

export type RemoteFolder = {
  stableKey: string;
  path: string;
  name: string;
  delimiter: string | null;
  parentPath: string | null;
  role: FolderRole;
  subscribed: boolean;
  selectable: boolean;
  uidValidity: string | null;
  uidNext: string | null;
  highestModseq: string | null;
  rights: string[];
  rightsSource: FolderRightsSource;
};

export type RemoteMessageRef = {
  folderStableKey: string;
  uidValidity: string;
  uid: string;
  modseq: string | null;
};

export type ConnectorCapabilities = {
  idle: boolean;
  condstore: boolean;
  qresync: boolean;
  move: boolean;
  uidplus: boolean;
  namespace: boolean;
  listExtended: boolean;
  specialUse: boolean;
  acl: boolean;
  notify: boolean;
  gmailExtensions: boolean;
};

export type ConnectorVerification = {
  authenticatedPrincipal: string;
  serverIdentity: Record<string, unknown>;
  capabilities: ConnectorCapabilities;
  accounts: RemoteAccount[];
};
