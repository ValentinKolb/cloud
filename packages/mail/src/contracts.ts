import type {
  WorkflowDiagnostic as KernelWorkflowDiagnostic,
  WorkflowBoundPlan,
  WorkflowIr,
  WorkflowJsonValue,
} from "@valentinkolb/cloud/workflows";
import { ContactMailMatchSchema, NormalizedParticipantEmailSchema } from "@valentinkolb/cloud-app-contacts/integration";
import { z } from "zod";

export const messageInspectorHeaderSchema = z
  .object({
    name: z.string().min(1).max(998),
    value: z.string().max(2 * 1024 * 1024),
  })
  .strict();

export const messageInspectorPlacementSchema = z
  .object({
    remoteMessageRefId: z.uuid(),
    folderId: z.uuid(),
    folderName: z.string().max(4096),
    remotePath: z.string().max(4096),
    uidValidity: z.string().max(128),
    uid: z.string().max(128),
    modseq: z.string().max(128).nullable(),
    flags: z.array(z.string().max(4096)).max(1024),
    keywords: z.array(z.string().max(4096)).max(1024),
  })
  .strict();

export const messageInspectorPartSchema = z
  .object({
    id: z.uuid(),
    partPath: z.string().max(4096),
    contentType: z.string().max(4096),
    charset: z.string().max(4096).nullable(),
    transferEncoding: z.string().max(4096).nullable(),
    disposition: z.string().max(4096).nullable(),
    contentId: z.string().max(8192).nullable(),
    filename: z.string().max(8192).nullable(),
    sizeBytes: z.number().int().nonnegative(),
    hydrationStatus: z.string().max(128),
  })
  .strict();

export const messageInspectorAttachmentSchema = z
  .object({
    id: z.uuid(),
    partId: z.uuid(),
    filename: z.string().max(8192).nullable(),
    contentType: z.string().max(4096),
    disposition: z.string().max(4096).nullable(),
    contentId: z.string().max(8192).nullable(),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const messageInspectorMailingListSchema = z
  .object({
    listKey: z.string().min(1).max(4096),
    name: z.string().min(1).max(4096),
    address: z.string().min(1).max(4096),
    postHref: z.string().max(2048).nullable(),
    helpHref: z.string().max(2048).nullable(),
    archiveHref: z.string().max(2048).nullable(),
  })
  .strict();

export const messageInspectorSchema = z
  .object({
    id: z.uuid(),
    messageId: z.string().max(8192).nullable(),
    inReplyTo: z.string().max(8192).nullable(),
    referenceIds: z.array(z.string().max(8192)).max(10_000),
    subject: z.string().max(32_768),
    internalDate: z.string().datetime(),
    sentAt: z.string().datetime().nullable(),
    sizeBytes: z.number().int().nonnegative(),
    hydrationStatus: z.string().max(128),
    hydrationErrorCode: z.string().max(4096).nullable(),
    contentHash: z.string().length(64),
    sourceHash: z.string().length(64).nullable(),
    contentType: z.string().max(4096).nullable(),
    source: z
      .object({
        available: z.boolean(),
        exact: z.boolean(),
        byteLength: z.number().int().nonnegative().nullable(),
        contentHash: z.string().length(64).nullable(),
      })
      .strict(),
    headers: z.array(messageInspectorHeaderSchema).max(10_000),
    rawHeaders: z.string().max(2 * 1024 * 1024),
    headersComplete: z.boolean(),
    placements: z.array(messageInspectorPlacementSchema).max(1000),
    parts: z.array(messageInspectorPartSchema).max(10_000),
    attachments: z.array(messageInspectorAttachmentSchema).max(10_000),
    mailingList: messageInspectorMailingListSchema.nullable(),
    warnings: z.array(z.string().max(4096)).max(100),
  })
  .strict();
export type MessageInspector = z.infer<typeof messageInspectorSchema>;

export const messageSourcePreviewSchema = z
  .object({
    messageId: z.uuid(),
    exact: z.literal(true),
    text: z.string().max(256 * 1024),
    byteLength: z.number().int().nonnegative(),
    previewByteLength: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();
export type MessageSourcePreview = z.infer<typeof messageSourcePreviewSchema>;

export const mailingListKeySchema = z.string().trim().toLowerCase().min(1).max(4096);

export const mailSubscriptionLinkSchema = z
  .object({
    kind: z.enum(["one_click", "web", "email"]),
    href: z.string().min(1).max(2048),
  })
  .strict();

export const mailSubscriptionSummarySchema = z
  .object({
    listKey: mailingListKeySchema,
    name: z.string().min(1).max(4096),
    address: z.string().min(1).max(4096),
    status: z.enum(["active", "requesting", "unsubscribe_requested", "failed"]),
    unsubscribe: mailSubscriptionLinkSchema.nullable(),
    postHref: z.string().min(1).max(2048).nullable(),
    helpHref: z.string().min(1).max(2048).nullable(),
    archiveHref: z.string().min(1).max(2048).nullable(),
    messageCount: z.number().int().nonnegative(),
    recentMessageCount: z.number().int().nonnegative(),
    conversationCount: z.number().int().nonnegative(),
    lastMessageAt: z.string().datetime(),
    lastSubject: z.string().max(32_768),
    lastSender: z.string().max(4096).nullable(),
    lastMessageId: z.uuid(),
    lastConversationId: z.uuid().nullable(),
    unsubscribeRequestedAt: z.string().datetime().nullable(),
    unsubscribeErrorCode: z.string().max(200).nullable(),
  })
  .strict();
export type MailSubscriptionSummary = z.infer<typeof mailSubscriptionSummarySchema>;

export const mailSubscriptionPageSchema = z
  .object({
    // A focused item may be prepended to a full cursor page so direct links
    // remain stable while the canonical page cursor still advances normally.
    items: z.array(mailSubscriptionSummarySchema).max(101),
    nextCursor: z.string().max(2048).nullable(),
  })
  .strict();
export type MailSubscriptionPage = z.infer<typeof mailSubscriptionPageSchema>;

export const unsubscribeMailingListInputSchema = z
  .object({
    listKey: mailingListKeySchema,
    href: z.string().trim().min(1).max(2048),
  })
  .strict();
export type UnsubscribeMailingListInput = z.infer<typeof unsubscribeMailingListInputSchema>;

export const unsubscribeMailingListResultSchema = z
  .object({
    listKey: z.string().min(1).max(4096),
    status: z.literal("unsubscribe_requested"),
    requestedAt: z.string().datetime(),
  })
  .strict();
export type UnsubscribeMailingListResult = z.infer<typeof unsubscribeMailingListResultSchema>;

export const mailingListDispositionInputSchema = z
  .object({
    listKey: mailingListKeySchema,
    disposition: z.enum(["archive", "trash"]),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();
export type MailingListDispositionInput = z.infer<typeof mailingListDispositionInputSchema>;

export const mailingListDispositionResultSchema = z
  .object({
    commandCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();
export type MailingListDispositionResult = z.infer<typeof mailingListDispositionResultSchema>;

export const mailConversationContextQuerySchema = z
  .object({
    contactsCursor: z.string().min(1).max(2048).optional(),
    contactsLimit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();
export type MailConversationContextQuery = z.infer<typeof mailConversationContextQuerySchema>;

export const mailConversationParticipantSchema = z
  .object({
    email: NormalizedParticipantEmailSchema,
    displayName: z.string().min(1).max(500).nullable(),
  })
  .strict();

export const mailConversationContextSchema = z
  .object({
    conversationId: z.uuid(),
    participants: z.array(mailConversationParticipantSchema).max(100),
    contacts: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("ready"),
          items: z.array(ContactMailMatchSchema),
          matchedEmails: z.array(NormalizedParticipantEmailSchema).max(100),
          nextCursor: z.string().nullable(),
        })
        .strict(),
      z
        .object({
          status: z.literal("unavailable"),
          items: z.array(z.never()).length(0),
          matchedEmails: z.array(z.never()).length(0),
          nextCursor: z.null(),
        })
        .strict(),
    ]),
  })
  .strict();
export type MailConversationContext = z.infer<typeof mailConversationContextSchema>;

export const relatedMailSummarySchema = z
  .object({
    id: z.uuid(),
    subject: z.string(),
    participantSummary: z.string(),
    latestMessageAt: z.string().datetime(),
    preview: z.string().nullable(),
  })
  .strict();
export const relatedMailPageSchema = z
  .object({
    items: z.array(relatedMailSummarySchema).max(25),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type RelatedMailPage = z.infer<typeof relatedMailPageSchema>;

export const relatedMailQuerySchema = z
  .object({
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  })
  .strict();
export const searchBackendSchema = z.enum([
  "auto",
  "postgres",
  "pg_textsearch",
]);
export type SearchBackend = z.infer<typeof searchBackendSchema>;

export const automaticReplyManagementPermissionSchema = z.enum([
  "write",
  "admin",
]);
export type AutomaticReplyManagementPermission = z.infer<
  typeof automaticReplyManagementPermissionSchema
>;

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

export const endpointSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  tlsMode: tlsModeSchema,
});
export type MailEndpoint = z.infer<typeof endpointSchema>;

export const providerSecretSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("password"),
    password: z.string().min(1).max(16_384),
  }),
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
export type ProviderConnectionInput = z.infer<
  typeof providerConnectionInputSchema
>;

export const providerConnectionDetailsSchema =
  providerConnectionInputSchema.omit({ secret: true });
export type ProviderConnectionDetails = z.infer<
  typeof providerConnectionDetailsSchema
>;

export const mailOAuthProviderIdSchema = z.enum(["google", "microsoft"]);
export type MailOAuthProviderId = z.infer<typeof mailOAuthProviderIdSchema>;

export const mailOAuthProviderSchema = z.object({
  id: mailOAuthProviderIdSchema,
  name: z.string(),
  domains: z.array(z.string()),
});
export type MailOAuthProvider = z.infer<typeof mailOAuthProviderSchema>;

export const mailOAuthStartInputSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    providerId: mailOAuthProviderIdSchema,
    connection: providerConnectionDetailsSchema,
    createSender: z.boolean().default(true),
  }),
  z.object({
    operation: z.literal("reconnect"),
    providerId: mailOAuthProviderIdSchema,
    connectionId: z.string().uuid(),
    connection: providerConnectionDetailsSchema.optional(),
  }),
]);
export type MailOAuthStartInput = z.infer<typeof mailOAuthStartInputSchema>;

export const mailOAuthStartResultSchema = z.object({
  authorizationUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});
export type MailOAuthStartResult = z.infer<typeof mailOAuthStartResultSchema>;

export const providerTransportDiagnosticSchema = z.object({
  status: z.enum(["verified", "failed"]),
  category: z
    .enum(["authentication", "tls", "endpoint", "unavailable", "unknown"])
    .nullable(),
  message: z.string(),
});
export type ProviderTransportDiagnostic = z.infer<
  typeof providerTransportDiagnosticSchema
>;

export const providerTransportDiagnosticsSchema = z.object({
  imap: providerTransportDiagnosticSchema,
  smtp: providerTransportDiagnosticSchema,
});
export type ProviderTransportDiagnostics = z.infer<
  typeof providerTransportDiagnosticsSchema
>;

export const mailOAuthFlowResultSchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid(),
  status: z.enum(["pending", "exchanging", "completed", "failed"]),
  resultCode: z.string().nullable(),
  message: z.string().nullable(),
  connectionId: z.string().uuid().nullable(),
  diagnostics: providerTransportDiagnosticsSchema.nullable(),
});
export type MailOAuthFlowResult = z.infer<typeof mailOAuthFlowResultSchema>;

export const providerConnectionSchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  username: z.string(),
  connectorKind: connectorKindSchema,
  imap: endpointSchema,
  smtp: endpointSchema,
  secret: z.object({
    kind: z.enum(["password", "oauth2"]),
    isSet: z.boolean(),
  }),
  oauth: z
    .object({
      providerId: mailOAuthProviderIdSchema,
      expiresAt: z.string().datetime().nullable(),
      state: z.enum(["active", "expiring", "reconnect_required"]),
    })
    .nullable(),
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
  health: mailboxHealthSchema,
  healthReason: z.string().nullable(),
  syncEnabled: z.boolean(),
  searchBackend: searchBackendSchema,
  automaticReplyManagementPermission: automaticReplyManagementPermissionSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Mailbox = z.infer<typeof mailboxSchema>;

export const deletedMailboxSchema = mailboxSchema.extend({
  deletedAt: z.string().datetime(),
});
export type DeletedMailbox = z.infer<typeof deletedMailboxSchema>;
export type DeletedMailboxPage = {
  items: Array<DeletedMailbox & { permission: "admin" }>;
  nextCursor: string | null;
};

const lifecycleCountsSchema = z.record(
  z.string(),
  z.number().int().nonnegative()
);

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
export type MailboxOperationalHealth = z.infer<
  typeof mailboxOperationalHealthSchema
>;

export const attachmentLinkSchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid(),
  sourceKind: z.enum(["message", "draft"]),
  sourceId: z.string().uuid(),
  filename: z.string().nullable(),
  contentType: z.string(),
  byteLength: z
    .number()
    .int()
    .nonnegative()
    .max(100 * 1024 * 1024),
  passwordProtected: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  downloadCount: z.number().int().nonnegative(),
  maxDownloads: z.number().int().positive().nullable(),
  lastDownloadedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type AttachmentLink = z.infer<typeof attachmentLinkSchema>;

export const attachmentLinkPageSchema = z.object({
  items: z.array(attachmentLinkSchema),
  nextCursor: z.string().nullable(),
});
export type AttachmentLinkPage = z.infer<typeof attachmentLinkPageSchema>;

export const createAttachmentLinkInputSchema = z
  .object({
    password: z.string().min(8).max(256).nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    maxDownloads: z.number().int().min(1).max(1_000_000).nullable().optional(),
  })
  .strict();
export type CreateAttachmentLinkInput = z.infer<
  typeof createAttachmentLinkInputSchema
>;

export const createdAttachmentLinkSchema = z.object({
  link: attachmentLinkSchema,
  url: z.string().url(),
});
export type CreatedAttachmentLink = z.infer<typeof createdAttachmentLinkSchema>;

export const mailboxStorageUsageSchema = z.object({
  mailboxId: z.string().uuid(),
  mailboxName: z.string(),
  messageCount: z.number().int().nonnegative(),
  messageBytes: z.number().int().nonnegative(),
  receivedAttachmentBytes: z.number().int().nonnegative(),
  draftAttachmentBytes: z.number().int().nonnegative(),
  externalLinkBytes: z.number().int().nonnegative(),
  logicalTotalBytes: z.number().int().nonnegative(),
  calculatedAt: z.string().datetime(),
});
export type MailboxStorageUsage = z.infer<typeof mailboxStorageUsageSchema>;

export const mailStorageSummarySchema = z.object({
  mailboxes: z.array(mailboxStorageUsageSchema),
  physicalDatabaseBytes: z.number().int().nonnegative(),
  physicalBlobBytes: z.number().int().nonnegative(),
  calculatedAt: z.string().datetime().nullable(),
});
export type MailStorageSummary = z.infer<typeof mailStorageSummarySchema>;

export const createMailboxInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).nullable().optional(),
});
export type CreateMailboxInput = z.infer<typeof createMailboxInputSchema>;

export const bindingStateSchema = z.enum([
  "pending",
  "verifying",
  "active",
  "degraded",
  "revoked",
]);
export type BindingState = z.infer<typeof bindingStateSchema>;

export const providerBindingSchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid(),
  connectionId: z.string().uuid(),
  state: bindingStateSchema,
  authenticatedPrincipal: z.string().nullable(),
  capabilities: z.record(z.string(), z.unknown()),
  lastVerifiedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProviderBinding = z.infer<typeof providerBindingSchema>;

export const folderRoleSchema = z.enum([
  "inbox",
  "sent",
  "drafts",
  "trash",
  "archive",
  "junk",
  "all",
  "other",
]);
export type FolderRole = z.infer<typeof folderRoleSchema>;

export const folderRightsSourceSchema = z.enum([
  "acl",
  "select",
  "probe",
  "unknown",
]);
export type FolderRightsSource = z.infer<typeof folderRightsSourceSchema>;

export const configurableFolderRoleSchema = z.enum([
  "sent",
  "drafts",
  "trash",
  "archive",
  "junk",
]);
export type ConfigurableFolderRole = z.infer<
  typeof configurableFolderRoleSchema
>;

export const standardMessageFlagSchema = z.enum([
  "seen",
  "answered",
  "flagged",
  "draft",
]);
export type StandardMessageFlag = z.infer<typeof standardMessageFlagSchema>;

export const addressRoleSchema = z.enum([
  "from",
  "reply_to",
  "to",
  "cc",
  "bcc",
]);
export type AddressRole = z.infer<typeof addressRoleSchema>;

export const mailSearchFieldSchema = z.enum([
  "any",
  "subject",
  "body",
  "from",
  "to",
  "cc",
  "bcc",
  "recipients",
  "participants",
  "message_id",
  "attachment_name",
  "comment",
  "reference",
  "folder",
  "tag",
  "keyword",
]);
export type MailSearchField = z.infer<typeof mailSearchFieldSchema>;

export const mailSearchTermSchema = z
  .object({
    type: z.literal("text"),
    field: mailSearchFieldSchema,
    query: z.string().trim().min(1).max(500),
    match: z.enum(["words", "phrase", "contains", "exact"]).default("words"),
  })
  .strict();

export const mailSearchDateSchema = z
  .object({
    type: z.literal("date"),
    field: z.enum(["internal_date", "sent_at"]),
    operator: z.enum(["before", "on_or_before", "after", "on_or_after"]),
    value: z.string().datetime(),
  })
  .strict();

export const mailSearchSizeSchema = z
  .object({
    type: z.literal("size"),
    field: z.enum(["message", "attachment"]),
    operator: z.enum([
      "less_than",
      "at_most",
      "equal",
      "at_least",
      "greater_than",
    ]),
    bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const mailSearchWorkStatusSchema = z
  .object({
    type: z.literal("work_status"),
    value: z.enum(["needs_action", "waiting", "done"]),
  })
  .strict();
export const mailSearchAssigneeSchema = z
  .object({ type: z.literal("assignee"), userId: z.string().uuid().nullable() })
  .strict();
export const mailSearchSnoozedSchema = z
  .object({ type: z.literal("snoozed"), value: z.boolean() })
  .strict();
export const mailSearchAllSchema = z
  .object({ type: z.literal("all") })
  .strict();
export const mailSearchFolderIdSchema = z
  .object({ type: z.literal("folder_id"), folderId: z.string().uuid() })
  .strict();
export const mailSearchAssignedToMeSchema = z
  .object({ type: z.literal("assigned_to_me") })
  .strict();

const MAX_BOOLEAN_TREE_DEPTH = 8;
const MAX_BOOLEAN_TREE_NODES = 100;

const boundedTreeInputSchema = (params: {
  label: string;
  children: (value: Record<string, unknown>) => unknown[];
}): z.ZodType<unknown> =>
  z.unknown().superRefine((value, context) => {
    const stack: Array<{ value: unknown; depth: number }> = [
      { value, depth: 1 },
    ];
    const seen = new WeakSet<object>();
    let nodes = 0;
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (
        !current.value ||
        typeof current.value !== "object" ||
        Array.isArray(current.value)
      )
        continue;
      if (seen.has(current.value)) {
        context.addIssue({
          code: "custom",
          message: `${params.label} may not contain cyclic or repeated nodes`,
        });
        return;
      }
      seen.add(current.value);
      nodes += 1;
      if (current.depth > MAX_BOOLEAN_TREE_DEPTH) {
        context.addIssue({
          code: "custom",
          message: `${params.label} may be at most ${MAX_BOOLEAN_TREE_DEPTH} levels deep`,
        });
        return;
      }
      if (nodes > MAX_BOOLEAN_TREE_NODES) {
        context.addIssue({
          code: "custom",
          message: `${params.label} may contain at most ${MAX_BOOLEAN_TREE_NODES} nodes`,
        });
        return;
      }
      for (const child of params.children(
        current.value as Record<string, unknown>
      )) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  });

export type MailSearchExpression =
  | z.infer<typeof mailSearchTermSchema>
  | z.infer<typeof mailSearchDateSchema>
  | z.infer<typeof mailSearchSizeSchema>
  | z.infer<typeof mailSearchWorkStatusSchema>
  | z.infer<typeof mailSearchAssigneeSchema>
  | z.infer<typeof mailSearchSnoozedSchema>
  | z.infer<typeof mailSearchAllSchema>
  | z.infer<typeof mailSearchFolderIdSchema>
  | z.infer<typeof mailSearchAssignedToMeSchema>
  | { type: "and"; expressions: MailSearchExpression[] }
  | { type: "or"; expressions: MailSearchExpression[] }
  | { type: "not"; expression: MailSearchExpression };

const mailSearchExpressionRecursiveSchema: z.ZodType<MailSearchExpression> =
  z.lazy(() =>
    z.discriminatedUnion("type", [
      mailSearchTermSchema,
      mailSearchDateSchema,
      mailSearchSizeSchema,
      mailSearchWorkStatusSchema,
      mailSearchAssigneeSchema,
      mailSearchSnoozedSchema,
      mailSearchAllSchema,
      mailSearchFolderIdSchema,
      mailSearchAssignedToMeSchema,
      z
        .object({
          type: z.literal("and"),
          expressions: z
            .array(mailSearchExpressionRecursiveSchema)
            .min(1)
            .max(20),
        })
        .strict(),
      z
        .object({
          type: z.literal("or"),
          expressions: z
            .array(mailSearchExpressionRecursiveSchema)
            .min(1)
            .max(20),
        })
        .strict(),
      z
        .object({
          type: z.literal("not"),
          expression: mailSearchExpressionRecursiveSchema,
        })
        .strict(),
    ])
  );

const mailSearchExpressionOpenApi = {
  $dynamicAnchor: "MailSearchExpression",
  oneOf: [
    {
      type: "object",
      properties: {
        type: { const: "text" },
        field: { type: "string", enum: mailSearchFieldSchema.options },
        query: { type: "string", minLength: 1, maxLength: 500 },
        match: {
          type: "string",
          enum: ["words", "phrase", "contains", "exact"],
          default: "words",
        },
      },
      required: ["type", "field", "query"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "date" },
        field: { type: "string", enum: ["internal_date", "sent_at"] },
        operator: {
          type: "string",
          enum: ["before", "on_or_before", "after", "on_or_after"],
        },
        value: { type: "string", format: "date-time" },
      },
      required: ["type", "field", "operator", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "size" },
        field: { type: "string", enum: ["message", "attachment"] },
        operator: {
          type: "string",
          enum: ["less_than", "at_most", "equal", "at_least", "greater_than"],
        },
        bytes: {
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      },
      required: ["type", "field", "operator", "bytes"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "work_status" },
        value: { type: "string", enum: ["needs_action", "waiting", "done"] },
      },
      required: ["type", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "assignee" },
        userId: { type: ["string", "null"], format: "uuid" },
      },
      required: ["type", "userId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "snoozed" }, value: { type: "boolean" } },
      required: ["type", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "all" } },
      required: ["type"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "folder_id" },
        folderId: { type: "string", format: "uuid" },
      },
      required: ["type", "folderId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "assigned_to_me" } },
      required: ["type"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "and" },
        expressions: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: { $dynamicRef: "#MailSearchExpression" },
        },
      },
      required: ["type", "expressions"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "or" },
        expressions: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: { $dynamicRef: "#MailSearchExpression" },
        },
      },
      required: ["type", "expressions"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "not" },
        expression: { $dynamicRef: "#MailSearchExpression" },
      },
      required: ["type", "expression"],
      additionalProperties: false,
    },
  ],
};

const validatedMailSearchExpressionSchema = boundedTreeInputSchema({
  label: "Search expressions",
  children: (value) => [
    ...(Array.isArray(value.expressions) ? value.expressions : []),
    ...(value.expression === undefined ? [] : [value.expression]),
  ],
}).pipe(mailSearchExpressionRecursiveSchema) as z.ZodType<MailSearchExpression>;

export const mailSearchExpressionSchema = z
  .unknown()
  .transform((value, context): MailSearchExpression => {
    const parsed = validatedMailSearchExpressionSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) context.addIssue({ ...issue });
    return z.NEVER;
  })
  .meta(mailSearchExpressionOpenApi);

export const mailSearchSortSchema = z.enum(["relevance", "newest"]);
export type MailSearchSort = z.infer<typeof mailSearchSortSchema>;

export const mailSearchStateSchema = z
  .object({
    expression: mailSearchExpressionSchema,
    sort: mailSearchSortSchema.default("relevance"),
  })
  .strict();
export type MailSearchState = z.infer<typeof mailSearchStateSchema>;

export const searchRequestSchema = z.object({
  expression: mailSearchExpressionSchema,
  sort: mailSearchSortSchema.default("relevance"),
  cursor: z.string().max(2_000).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export const mailExecutionOperationSchema = z.enum([
  "backgroundSync",
  "actorRead",
  "actorMutation",
  "actorSend",
  "automation",
]);
export type MailExecutionOperation = z.infer<
  typeof mailExecutionOperationSchema
>;

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
  "rebuild_search",
  "rebuild_threads",
  "reconcile_effect",
  "retry_command",
  "cancel_command",
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
  .refine(
    (value) => !value.startsWith("\\"),
    "Keywords cannot use the IMAP system-flag namespace"
  )
  .refine(
    (value) => !/[\u0000-\u001f\u007f()\{\s]/.test(value),
    "Keyword contains unsupported IMAP characters"
  );

export const remoteMessagePreconditionSchema = z
  .object({
    modseq: z.string().regex(/^\d+$/).nullable().optional(),
    flags: z.array(standardMessageFlagSchema).max(4).optional(),
    keywords: z.array(mailKeywordSchema).max(100).optional(),
  })
  .strict();
export type RemoteMessagePrecondition = z.infer<
  typeof remoteMessagePreconditionSchema
>;

const folderLeafNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => !/[\u0000\r\n]/.test(value),
    "Folder name contains unsupported characters"
  );

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
      ...value.removeKeywords.map(
        (keyword) => `keyword:${keyword.toLowerCase()}`
      ),
    ]);
    if (additions.size + removals.size === 0) {
      context.addIssue({
        code: "custom",
        message: "At least one state change is required",
      });
    }
    for (const item of additions) {
      if (removals.has(item)) {
        context.addIssue({
          code: "custom",
          message: `Cannot add and remove ${item.slice(
            item.indexOf(":") + 1
          )} in one command`,
        });
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
  z.object({
    kind: z.literal("move_to_folder"),
    sourceFolderId: z.string().uuid(),
    destinationFolderId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(1).max(150),
    correlationId: z.string().trim().max(200).optional(),
  }),
]);
export type ConversationTriageInput = z.infer<
  typeof conversationTriageInputSchema
>;

export const actorCommandInputSchema = z.discriminatedUnion("kind", [
  actorCommandBaseSchema.extend({
    kind: z.literal("set_flags"),
    remoteMessageRefId: z.string().uuid(),
    folderId: z.string().uuid(),
    flags: z.array(z.string().trim().min(1).max(100)).max(100),
    expectedRemoteState: remoteMessagePreconditionSchema.optional(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("change_message_state"),
    remoteMessageRefId: z.string().uuid(),
    folderId: z.string().uuid(),
    change: messageStateChangeSchema,
    expectedRemoteState: remoteMessagePreconditionSchema.optional(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("move"),
    remoteMessageRefId: z.string().uuid(),
    sourceFolderId: z.string().uuid(),
    destinationFolderId: z.string().uuid(),
    expectedRemoteState: remoteMessagePreconditionSchema.optional(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("copy"),
    remoteMessageRefId: z.string().uuid(),
    sourceFolderId: z.string().uuid(),
    destinationFolderId: z.string().uuid(),
    expectedRemoteState: remoteMessagePreconditionSchema.optional(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("delete"),
    remoteMessageRefId: z.string().uuid(),
    folderId: z.string().uuid(),
    expectedRemoteState: remoteMessagePreconditionSchema.optional(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("create_folder"),
    parentFolderId: z.string().uuid().nullable().optional(),
    name: folderLeafNameSchema,
    subscribe: z.boolean().default(true),
    showInSidebar: z.boolean().default(true),
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
    expectedDraftRevision: z.number().int().positive(),
    senderIdentityId: z.string().uuid(),
    scheduledAt: z.string().datetime().optional(),
    undoSeconds: z.number().int().min(0).max(60).default(10),
  }),
]);
export type ActorCommandInput = z.infer<typeof actorCommandInputSchema>;

export const maintenanceCommandInputSchema = z.discriminatedUnion("kind", [
  actorCommandBaseSchema.extend({ kind: z.literal("sync_mailbox") }),
  actorCommandBaseSchema.extend({
    kind: z.literal("sync_folder"),
    folderId: z.string().uuid(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("discover_folders"),
    bindingId: z.string().uuid().optional(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("verify_binding"),
    bindingId: z.string().uuid(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("rebuild_folder"),
    folderId: z.string().uuid(),
  }),
  actorCommandBaseSchema.extend({ kind: z.literal("hydrate_missing") }),
  actorCommandBaseSchema.extend({ kind: z.literal("rebuild_search") }),
  actorCommandBaseSchema.extend({ kind: z.literal("rebuild_threads") }),
  actorCommandBaseSchema.extend({
    kind: z.literal("reconcile_effect"),
    commandId: z.string().uuid(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("retry_command"),
    commandId: z.string().uuid(),
  }),
  actorCommandBaseSchema.extend({
    kind: z.literal("cancel_command"),
    commandId: z.string().uuid(),
  }),
]);
export type MaintenanceCommandInput = z.infer<
  typeof maintenanceCommandInputSchema
>;

export const mailCommandInputSchema = z.union([
  actorCommandInputSchema,
  maintenanceCommandInputSchema,
]);
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

export const operatorActionKindSchema = z.enum([
  "sync_mailbox",
  "sync_folder",
  "discover_folders",
  "verify_binding",
  "rebuild_folder",
  "hydrate_missing",
  "rebuild_search",
  "rebuild_threads",
  "reconcile_effect",
  "retry_command",
  "cancel_command",
]);
export type OperatorActionKind = z.infer<typeof operatorActionKindSchema>;

export const operatorActionSafetySchema = z.enum([
  "remote_read",
  "local_projection",
  "reconcile_only",
  "state_transition",
]);
export type OperatorActionSafety = z.infer<typeof operatorActionSafetySchema>;

export const operatorActionEligibilitySchema = z
  .object({
    kind: operatorActionKindSchema,
    target: z.record(z.string(), z.string().uuid()),
    safety: operatorActionSafetySchema,
    eligible: z.boolean(),
    reason: z.string().nullable(),
  })
  .strict();
export type OperatorActionEligibility = z.infer<
  typeof operatorActionEligibilitySchema
>;

export const redactedOperatorCommandSchema = z
  .object({
    id: z.string().uuid(),
    kind: commandKindSchema,
    state: commandStateSchema,
    attempt: z.number().int().nonnegative(),
    errorCode: z.string().nullable(),
    providerEffectStarted: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    actions: z.array(operatorActionEligibilitySchema),
  })
  .strict();
export type RedactedOperatorCommand = z.infer<
  typeof redactedOperatorCommandSchema
>;

const operatorStateCountsSchema = z.record(
  z.string(),
  z.number().int().nonnegative()
);
const operatorCoverageSchema = z.object({
  total: z.number().int().nonnegative(),
  covered: z.number().int().nonnegative(),
});

export const mailboxOperatorOperationsSchema = z
  .object({
    mailboxId: z.string().uuid(),
    mailboxName: z.string(),
    health: mailboxHealthSchema,
    syncEnabled: z.boolean(),
    sync: z.object({
      lastAt: z.string().datetime().nullable(),
      lagSeconds: z.number().int().nonnegative().nullable(),
      states: operatorStateCountsSchema,
    }),
    coverage: z.object({
      hydration: operatorCoverageSchema,
      search: operatorCoverageSchema,
      threads: operatorCoverageSchema,
    }),
    queues: z.object({
      commands: operatorStateCountsSchema,
      outbox: operatorStateCountsSchema,
      workflows: operatorStateCountsSchema,
      automaticReplies: operatorStateCountsSchema,
      automaticReplySuppressions: operatorStateCountsSchema,
    }),
    connectors: z.object({
      activeBindings: z.number().int().nonnegative(),
      degradedBindings: z.number().int().nonnegative(),
      capabilities: z.record(z.string(), z.number().int().nonnegative()),
      pushModes: operatorStateCountsSchema,
      pushStates: operatorStateCountsSchema,
      draftProjectionStates: operatorStateCountsSchema,
    }),
    search: z.object({
      configuredBackend: searchBackendSchema,
      effectiveBackend: z.enum(["postgres", "pg_textsearch"]),
      fallbackActive: z.boolean(),
    }),
    references: z.object({
      configured: z.boolean(),
      allocated: z.number().int().nonnegative(),
    }),
    folders: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(1000),
        discoveryState: z.enum(["active", "missing", "ambiguous"]),
        syncStatus: z.string(),
        selectedForSync: z.boolean(),
        actions: z.array(operatorActionEligibilitySchema),
      })
    ),
    recentCommands: z.array(redactedOperatorCommandSchema),
    attentionCommands: z.array(redactedOperatorCommandSchema),
    attentionCount: z.number().int().nonnegative(),
    nextAttentionCursor: z.string().nullable(),
    actions: z.array(operatorActionEligibilitySchema),
    generatedAt: z.string().datetime(),
  })
  .strict();
export type MailboxOperatorOperations = z.infer<
  typeof mailboxOperatorOperationsSchema
>;

export const platformMailboxOperationSummarySchema = z
  .object({
    mailboxId: z.string().uuid(),
    mailboxName: z.string(),
    health: mailboxHealthSchema,
    syncEnabled: z.boolean(),
    sync: z.object({
      lastAt: z.string().datetime().nullable(),
      lagSeconds: z.number().int().nonnegative().nullable(),
    }),
    coverage: z.object({
      hydration: operatorCoverageSchema,
      search: operatorCoverageSchema,
      threads: operatorCoverageSchema,
    }),
    attentionCount: z.number().int().nonnegative(),
  })
  .strict();
export type PlatformMailboxOperationSummary = z.infer<
  typeof platformMailboxOperationSummarySchema
>;

export const platformMailOperationsSchema = z
  .object({
    mailboxes: z.array(platformMailboxOperationSummarySchema),
    attentionCount: z.number().int().nonnegative(),
    generatedAt: z.string().datetime(),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type PlatformMailOperations = z.infer<
  typeof platformMailOperationsSchema
>;

export const actorRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.string().uuid() }),
  z.object({
    kind: z.literal("service_account"),
    serviceAccountId: z.string().uuid(),
    delegatedUserId: z.string().uuid().nullable(),
  }),
  z.object({
    kind: z.literal("workflow"),
    workflowVersionId: z.string().uuid(),
  }),
  z.object({ kind: z.literal("system") }),
]);
export type ActorRef = z.infer<typeof actorRefSchema>;

export const conversationWorkStatusSchema = z.enum(["needs_action", "waiting", "done"]);
export type ConversationWorkStatus = z.infer<
  typeof conversationWorkStatusSchema
>;

export const workflowEffectBudgetSchema = z
  .object({
    maxTargets: z.number().int().min(1).max(50_000).default(1_000),
    maxMoves: z.number().int().min(0).max(50_000).default(1_000),
    maxCopies: z.number().int().min(0).max(50_000).default(1_000),
    maxSends: z.number().int().min(0).max(50_000).default(1_000),
    maxDrafts: z.number().int().min(0).max(50_000).default(1_000),
    maxFlagChanges: z.number().int().min(0).max(100_000).default(2_000),
    maxNotifications: z.number().int().min(0).max(50_000).default(1_000),
    maxKeywordChanges: z.number().int().min(0).max(100_000).default(2_000),
    maxCollaborationChanges: z
      .number()
      .int()
      .min(0)
      .max(100_000)
      .default(2_000),
  })
  .strict()
  .default({
    maxTargets: 1_000,
    maxMoves: 1_000,
    maxCopies: 1_000,
    maxSends: 1_000,
    maxDrafts: 1_000,
    maxFlagChanges: 2_000,
    maxNotifications: 1_000,
    maxKeywordChanges: 2_000,
    maxCollaborationChanges: 2_000,
  });
type ParsedWorkflowEffectBudget = z.infer<typeof workflowEffectBudgetSchema>;
export type WorkflowEffectBudget = Omit<
  ParsedWorkflowEffectBudget,
  "maxSends" | "maxCopies" | "maxDrafts" | "maxFlagChanges" | "maxNotifications"
> & {
  maxSends?: number;
  maxCopies?: number;
  maxDrafts?: number;
  maxFlagChanges?: number;
  maxNotifications?: number;
};

export const workflowTargetQuerySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }).strict(),
  z
    .object({
      type: z.literal("search"),
      expression: mailSearchExpressionSchema,
    })
    .strict(),
]);
export type WorkflowTargetQuery = z.infer<typeof workflowTargetQuerySchema>;

export const workflowRunTargetSelectionSchema = z.union([
  workflowTargetQuerySchema,
  z
    .object({
      type: z.literal("trigger"),
      kind: z.string().min(1).max(120),
      deliveryKey: z.string().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("retry"),
      sourceRunId: z.string().uuid(),
      targetIds: z.array(z.string().uuid()).min(1).max(500),
    })
    .strict(),
]);
export type WorkflowRunTargetSelection = z.infer<
  typeof workflowRunTargetSelectionSchema
>;

const workflowSourceSchema = z
  .string()
  .min(1)
  .max(200_000)
  .refine(
    (source) => source.trim().length > 0,
    "Workflow source cannot be blank"
  );
const workflowVersionIdSchema = z.string().uuid();
const workflowVersionIdentitySchema = z.string().min(1).max(200);
const workflowHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const isWorkflowJsonValue = (value: unknown): value is WorkflowJsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isWorkflowJsonValue);
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every(isWorkflowJsonValue)
  );
};
export const workflowJsonValueSchema = z
  .unknown()
  .refine(isWorkflowJsonValue, "Expected a JSON value")
  .meta({
    $dynamicAnchor: "WorkflowJsonValue",
    oneOf: [
      { type: "string" },
      { type: "number" },
      { type: "boolean" },
      { type: "null" },
      { type: "array", items: { $dynamicRef: "#WorkflowJsonValue" } },
      {
        type: "object",
        additionalProperties: { $dynamicRef: "#WorkflowJsonValue" },
      },
    ],
  }) as z.ZodType<WorkflowJsonValue>;
const workflowInputsSchema = z
  .record(z.string(), workflowJsonValueSchema)
  .default({});
const workflowIdempotencyKeySchema = z.string().trim().min(1).max(200);

export const validateWorkflowInputSchema = z
  .object({ source: workflowSourceSchema })
  .strict();
export type ValidateWorkflowInput = z.infer<typeof validateWorkflowInputSchema>;

export const createWorkflowInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2_000).nullable().optional(),
    priority: z.number().int().min(-1_000).max(1_000).default(100),
    source: workflowSourceSchema,
    effectBudget: workflowEffectBudgetSchema,
  })
  .strict();
export type CreateWorkflowInput = z.infer<typeof createWorkflowInputSchema>;

export const createWorkflowVersionInputSchema = z
  .object({
    source: workflowSourceSchema,
    effectBudget: workflowEffectBudgetSchema,
  })
  .strict();
export type CreateWorkflowVersionInput = z.infer<
  typeof createWorkflowVersionInputSchema
>;

export const activateWorkflowInputSchema = z
  .object({ expectedVersionId: workflowVersionIdSchema })
  .strict();
export type ActivateWorkflowInput = z.infer<typeof activateWorkflowInputSchema>;

export const deactivateWorkflowInputSchema = z
  .object({ expectedVersionId: workflowVersionIdSchema })
  .strict();
export type DeactivateWorkflowInput = z.infer<
  typeof deactivateWorkflowInputSchema
>;

const workflowVersionRequestSchema = z.object({
  expectedVersionId: workflowVersionIdSchema,
  inputs: workflowInputsSchema,
  query: workflowTargetQuerySchema,
});

export const dryRunWorkflowInputSchema = workflowVersionRequestSchema
  .extend({ idempotencyKey: workflowIdempotencyKeySchema })
  .strict();
export type DryRunWorkflowInput = z.infer<typeof dryRunWorkflowInputSchema>;

export const preflightWorkflowInputSchema =
  workflowVersionRequestSchema.strict();
export type PreflightWorkflowInput = z.infer<
  typeof preflightWorkflowInputSchema
>;

const effectfulWorkflowRunInputSchema = workflowVersionRequestSchema.extend({
  preflightHash: workflowHashSchema,
  occurredAt: z.string().datetime(),
  idempotencyKey: workflowIdempotencyKeySchema,
});

export const invokeWorkflowInputSchema =
  effectfulWorkflowRunInputSchema.strict();
export type InvokeWorkflowInput = z.infer<typeof invokeWorkflowInputSchema>;

export const backfillWorkflowInputSchema =
  effectfulWorkflowRunInputSchema.strict();
export type BackfillWorkflowInput = z.infer<typeof backfillWorkflowInputSchema>;

export const oneShotWorkflowInputSchema =
  effectfulWorkflowRunInputSchema.strict();
export type OneShotWorkflowInput = z.infer<typeof oneShotWorkflowInputSchema>;

export const workflowRunControlInputSchema = z
  .object({ reason: z.string().trim().min(1).max(1_000).optional() })
  .strict();
export type WorkflowRunControlInput = z.infer<
  typeof workflowRunControlInputSchema
>;
export const retryWorkflowRunInputSchema = z
  .object({
    targetIds: z
      .array(z.string().uuid())
      .min(1)
      .max(500)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Target IDs must be unique"
      ),
    idempotencyKey: workflowIdempotencyKeySchema,
    reason: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();
export type RetryWorkflowRunInput = z.infer<typeof retryWorkflowRunInputSchema>;

export const MAIL_WORKFLOW_CHANNELS = [
  "ui",
  "api",
  "bulk",
  "agent",
  "schedule",
  "event",
] as const;
export const workflowRunModeSchema = z.enum(["execute", "dryRun"]);
export type WorkflowRunMode = z.infer<typeof workflowRunModeSchema>;
export const workflowRunChannelSchema = z.enum(MAIL_WORKFLOW_CHANNELS);
export type WorkflowRunChannel = z.infer<typeof workflowRunChannelSchema>;
export const workflowRunKindSchema = z.enum([
  "invoke",
  "backfill",
  "oneShot",
  "trigger",
  "retry",
]);
export type WorkflowRunKind = z.infer<typeof workflowRunKindSchema>;
export const workflowRunStateSchema = z.enum([
  "materializing",
  "queued",
  "running",
  "waiting",
  "paused",
  "succeeded",
  "failed",
  "canceled",
  "needs_attention",
]);
export type WorkflowRunState = z.infer<typeof workflowRunStateSchema>;
export const workflowTargetStateSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "canceled",
  "needs_attention",
]);
export type WorkflowTargetState = z.infer<typeof workflowTargetStateSchema>;

export type WorkflowVersionIdentity = z.infer<
  typeof workflowVersionIdentitySchema
>;
export type WorkflowDiagnostic = KernelWorkflowDiagnostic;

export type WorkflowValidation = {
  valid: boolean;
  source: string;
  sourceHash: string | null;
  ir: WorkflowIr | null;
  boundPlan: WorkflowBoundPlan | null;
  diagnostics: WorkflowDiagnostic[];
};

export type MailWorkflowPreflight = {
  workflowVersionId: string;
  versionIdentity: WorkflowVersionIdentity;
  sourceHash: string;
  queryHash: string;
  preflightHash: string;
  occurredAt: string;
  effectBudget: WorkflowEffectBudget;
  actionCounts: Record<string, number>;
  targetCount: number;
};

export type MailWorkflow = {
  id: string;
  mailboxId: string;
  name: string;
  description: string | null;
  priority: number;
  currentVersionId: string;
  activeVersionId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MailWorkflowVersion = {
  id: string;
  identity: WorkflowVersionIdentity;
  workflowId: string;
  mailboxId: string;
  source: string;
  sourceHash: string;
  ir: WorkflowIr;
  boundPlan: WorkflowBoundPlan;
  diagnostics: WorkflowDiagnostic[];
  effectBudget: WorkflowEffectBudget;
  languageId: string;
  languageVersion: number;
  manifestHash: string;
  catalogHash: string;
  compiler: { name: string; version: string };
  createdAt: string;
};

export type MailWorkflowActivation = {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  key: string;
  kind: string;
  config: Record<string, WorkflowJsonValue>;
  enabled: boolean;
  diagnostics: WorkflowDiagnostic[];
  createdAt: string;
  updatedAt: string;
};

export type MailWorkflowDetail = MailWorkflow & {
  currentVersion: MailWorkflowVersion;
  activations: MailWorkflowActivation[];
};

export type MailWorkflowTargetProgress = Record<WorkflowTargetState, number> & {
  total: number;
};

export type MailWorkflowRun = {
  id: string;
  mailboxId: string;
  workflowId: string;
  workflowVersionId: string;
  versionIdentity: WorkflowVersionIdentity;
  sourceHash: string;
  kind: WorkflowRunKind;
  mode: WorkflowRunMode;
  channel: WorkflowRunChannel;
  state: WorkflowRunState;
  inputs: Record<string, WorkflowJsonValue>;
  query: WorkflowRunTargetSelection;
  preflightHash: string | null;
  retryOfRunId: string | null;
  pausedAt: string | null;
  pauseReason: string | null;
  targetProgress: MailWorkflowTargetProgress;
  result: WorkflowJsonValue | null;
  lastError: { code: string; message: string; retryable: boolean } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type MailWorkflowRunPage = {
  items: MailWorkflowRun[];
  nextCursor: string | null;
};

export type MailWorkflowRunTarget = {
  id: string;
  parentRunId: string;
  ordinal: number;
  targetKey: string;
  state: WorkflowTargetState;
  executionGeneration: number;
  inputs: Record<string, WorkflowJsonValue>;
  source: WorkflowJsonValue;
  preconditions: WorkflowJsonValue;
  result: WorkflowJsonValue | null;
  lastError: { code: string; message: string; retryable: boolean } | null;
  cancelRequestedAt: string | null;
  retryOfTargetId: string | null;
  hasRetry: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export const conversationViewSchema = z.enum([
  "needs_action",
  "mine",
  "unassigned",
  "waiting",
  "done",
  "snoozed",
  "recently_active",
]);
export type ConversationView = z.infer<typeof conversationViewSchema>;

export const mergeConversationsInputSchema = z
  .object({
    sourceConversationId: z.string().uuid(),
    expectedTargetRevision: z.number().int().positive(),
    expectedSourceRevision: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500).optional(),
    confirm: z.literal(true),
  })
  .strict();
export type MergeConversationsInput = z.infer<
  typeof mergeConversationsInputSchema
>;

export const splitConversationInputSchema = z
  .object({
    messageIds: z
      .array(z.string().uuid())
      .min(1)
      .max(5_000)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Message ids must be unique"
      ),
    expectedRevision: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500).optional(),
    confirm: z.literal(true),
  })
  .strict();
export type SplitConversationInput = z.infer<
  typeof splitConversationInputSchema
>;

export const reassignConversationMessageInputSchema = z
  .object({
    targetConversationId: z.string().uuid(),
    expectedSourceRevision: z.number().int().positive(),
    expectedTargetRevision: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500).optional(),
    confirm: z.literal(true),
  })
  .strict();
export type ReassignConversationMessageInput = z.infer<
  typeof reassignConversationMessageInputSchema
>;

export const updateConversationCollaborationSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    assigneeUserId: z.string().uuid().nullable().optional(),
    workStatus: conversationWorkStatusSchema.optional(),
    snoozedUntil: z.string().datetime().nullable().optional(),
  })
  .refine(
    (value) =>
      value.assigneeUserId !== undefined ||
      value.workStatus !== undefined ||
      value.snoozedUntil !== undefined,
    "At least one collaboration field is required"
  );
export type UpdateConversationCollaboration = z.infer<
  typeof updateConversationCollaborationSchema
>;

export const localTagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .transform((name) => name.replace(/\s+/gu, " "));
export const localTagColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/u, "Use a six-digit hex color")
  .transform((color) => color.toLowerCase());
export const createLocalTagSchema = z
  .object({ name: localTagNameSchema, color: localTagColorSchema })
  .strict();
export type CreateLocalTag = z.infer<typeof createLocalTagSchema>;

export const updateLocalTagSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    name: localTagNameSchema.optional(),
    color: localTagColorSchema.optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.color !== undefined, "Name or color is required");
export type UpdateLocalTag = z.infer<typeof updateLocalTagSchema>;

export const deleteLocalTagSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export type DeleteLocalTag = z.infer<typeof deleteLocalTagSchema>;

export const setConversationLocalTagsSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    tagIds: z.array(z.string().uuid()).max(50),
  })
  .strict()
  .refine((input) => new Set(input.tagIds).size === input.tagIds.length, {
    message: "Tag ids must be unique",
    path: ["tagIds"],
  });
export type SetConversationLocalTags = z.infer<
  typeof setConversationLocalTagsSchema
>;

export const addConversationLocalTagsSchema = z
  .object({
    conversationIds: z.array(z.string().uuid()).min(1).max(50),
    tagIds: z.array(z.string().uuid()).min(1).max(50),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.conversationIds).size !== input.conversationIds.length) {
      context.addIssue({ code: "custom", message: "Conversation ids must be unique", path: ["conversationIds"] });
    }
    if (new Set(input.tagIds).size !== input.tagIds.length) {
      context.addIssue({ code: "custom", message: "Tag ids must be unique", path: ["tagIds"] });
    }
  });
export type AddConversationLocalTags = z.infer<typeof addConversationLocalTagsSchema>;

export const conversationReferencePatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(120);
export const putConversationReferenceConfigurationSchema = z
  .object({
    expectedRevision: z.number().int().positive().nullable(),
    pattern: conversationReferencePatternSchema,
    enabled: z.boolean(),
    includeInReplySubjects: z.boolean(),
  })
  .strict();
export type PutConversationReferenceConfiguration = z.infer<
  typeof putConversationReferenceConfigurationSchema
>;

export const ensureConversationReferenceSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();
export type EnsureConversationReference = z.infer<
  typeof ensureConversationReferenceSchema
>;

const responseScheduleWindowSchema = z
  .object({ start: z.string(), end: z.string() })
  .strict();
export const responseScheduleDefinitionSchema = z
  .object({
    timeZone: z.string().trim().min(1).max(80),
    activeRanges: z
      .array(z.object({ from: z.string(), to: z.string().nullable() }).strict())
      .max(32),
    weeklyWindows: z
      .array(
        responseScheduleWindowSchema.extend({
          weekday: z.union([
            z.literal(1),
            z.literal(2),
            z.literal(3),
            z.literal(4),
            z.literal(5),
            z.literal(6),
            z.literal(7),
          ]),
        })
      )
      .max(64),
    exceptions: z
      .array(
        z
          .object({
            date: z.string(),
            closed: z.boolean(),
            windows: z.array(responseScheduleWindowSchema).max(32),
          })
          .strict()
      )
      .max(366),
  })
  .strict();
export type ResponseScheduleDefinitionInput = z.infer<
  typeof responseScheduleDefinitionSchema
>;

export const automaticReplyInactiveBehaviorSchema = z.enum(["skip", "defer"]);
export type AutomaticReplyInactiveBehavior = z.infer<
  typeof automaticReplyInactiveBehaviorSchema
>;

const automaticReplyConfigurationFields = {
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  senderIdentityId: z.string().uuid(),
  subject: z
    .string()
    .max(998)
    .refine((value) => value.trim().length > 0, "Subject cannot be blank"),
  body: z
    .string()
    .max(2 * 1024 * 1024)
    .refine((value) => value.trim().length > 0, "Message cannot be blank"),
  format: z.enum(["plain", "markdown"]),
  ensureReference: z.boolean(),
  minimumIntervalHours: z.number().int().min(0).max(8_760),
  inactiveBehavior: automaticReplyInactiveBehaviorSchema,
  schedule: responseScheduleDefinitionSchema,
} as const;

export const createAutomaticReplyConfigurationSchema = z
  .object({
    ...automaticReplyConfigurationFields,
    enabled: z.boolean().default(true),
    format: z.enum(["plain", "markdown"]).default("markdown"),
    ensureReference: z.boolean().default(false),
    minimumIntervalHours: z.number().int().min(0).max(8_760).default(24),
    inactiveBehavior: automaticReplyInactiveBehaviorSchema.default("skip"),
  })
  .strict();
export type CreateAutomaticReplyConfiguration = z.infer<
  typeof createAutomaticReplyConfigurationSchema
>;

export const updateAutomaticReplyConfigurationSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    ...automaticReplyConfigurationFields,
  })
  .strict();
export type UpdateAutomaticReplyConfiguration = z.infer<
  typeof updateAutomaticReplyConfigurationSchema
>;

const internalCommentBodySchema = z
  .string()
  .min(1)
  .max(50_000)
  .refine((body) => body.trim().length > 0, "Comment cannot be blank");

export const createConversationCommentSchema = z.object({
  body: internalCommentBodySchema,
  parentCommentId: z.string().uuid().nullable().optional(),
  referencedMessageId: z.string().uuid().nullable().optional(),
});
export type CreateConversationComment = z.infer<
  typeof createConversationCommentSchema
>;

export const updateConversationCommentSchema = z.object({
  expectedRevision: z.number().int().positive(),
  body: internalCommentBodySchema,
});
export type UpdateConversationComment = z.infer<
  typeof updateConversationCommentSchema
>;

export const deleteConversationCommentSchema = z.object({
  expectedRevision: z.number().int().positive(),
});
export type DeleteConversationComment = z.infer<
  typeof deleteConversationCommentSchema
>;

export const setConversationReminderSchema = z
  .object({
    dueAt: z.string().datetime(),
    expectedRevision: z.number().int().positive().nullable(),
  })
  .strict();
export type SetConversationReminder = z.infer<
  typeof setConversationReminderSchema
>;

export const cancelConversationReminderSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export type CancelConversationReminder = z.infer<
  typeof cancelConversationReminderSchema
>;

export const savedConversationViewScopeSchema = z.enum(["private", "mailbox"]);
export type SavedConversationViewScope = z.infer<
  typeof savedConversationViewScopeSchema
>;

export const savedConversationViewFilterSchema = mailSearchStateSchema;
export type SavedConversationViewFilter = MailSearchState;

export const createSavedConversationViewSchema = z
  .object({
    scope: savedConversationViewScopeSchema,
    name: z.string().trim().min(1).max(120),
    filter: savedConversationViewFilterSchema,
  })
  .strict();
export type CreateSavedConversationView = z.infer<
  typeof createSavedConversationViewSchema
>;

export const updateSavedConversationViewSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    name: z.string().trim().min(1).max(120).optional(),
    filter: savedConversationViewFilterSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.filter !== undefined,
    "At least one saved view field is required"
  );
export type UpdateSavedConversationView = z.infer<
  typeof updateSavedConversationViewSchema
>;

export const deleteSavedConversationViewSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export type DeleteSavedConversationView = z.infer<
  typeof deleteSavedConversationViewSchema
>;

export const conversationPresenceModeSchema = z.enum(["viewing", "composing"]);
export type ConversationPresenceMode = z.infer<
  typeof conversationPresenceModeSchema
>;

export const conversationPresenceHeartbeatSchema = z
  .object({
    peerId: z.string().uuid(),
    mode: conversationPresenceModeSchema,
  })
  .strict();
export type ConversationPresenceHeartbeat = z.infer<
  typeof conversationPresenceHeartbeatSchema
>;

export const conversationPresenceLeaveSchema = z
  .object({ peerId: z.string().uuid() })
  .strict();

export const draftLeaseTokenSchema = z
  .object({ token: z.string().uuid() })
  .strict();

export const composeTemplateKindSchema = z.enum(["signature", "snippet"]);
export type ComposeTemplateKind = z.infer<typeof composeTemplateKindSchema>;

export const composeTemplateScopeSchema = z.enum(["private", "mailbox"]);
export type ComposeTemplateScope = z.infer<typeof composeTemplateScopeSchema>;

export const composeTemplateShortcutSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Shortcut must start with a letter and use lowercase letters, numbers, or underscores"
  );

export const composeTemplateSchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid(),
  kind: composeTemplateKindSchema,
  scope: composeTemplateScopeSchema,
  ownerUserId: z.string().uuid().nullable(),
  name: z.string(),
  shortcut: composeTemplateShortcutSchema,
  body: z.string(),
  revision: z.number().int().positive(),
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ComposeTemplate = z.infer<typeof composeTemplateSchema>;

export const createComposeTemplateInputSchema = z
  .object({
    kind: composeTemplateKindSchema,
    scope: composeTemplateScopeSchema,
    name: z.string().trim().min(1).max(120),
    shortcut: composeTemplateShortcutSchema,
    body: z.string().min(1).max(200_000),
  })
  .strict();
export type CreateComposeTemplateInput = z.infer<
  typeof createComposeTemplateInputSchema
>;

export const updateComposeTemplateInputSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    name: z.string().trim().min(1).max(120).optional(),
    shortcut: composeTemplateShortcutSchema.optional(),
    body: z.string().min(1).max(200_000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.shortcut !== undefined ||
      value.body !== undefined,
    "At least one template field is required"
  );
export type UpdateComposeTemplateInput = z.infer<
  typeof updateComposeTemplateInputSchema
>;

export const archiveComposeTemplateInputSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export type ArchiveComposeTemplateInput = z.infer<
  typeof archiveComposeTemplateInputSchema
>;

export const composeSignatureDefaultSchema = z.object({
  mailboxId: z.string().uuid(),
  senderIdentityId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  templateId: z.string().uuid(),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
export type ComposeSignatureDefault = z.infer<
  typeof composeSignatureDefaultSchema
>;

export const setComposeSignatureDefaultInputSchema = z
  .object({
    scope: z.enum(["private", "mailbox"]),
    templateId: z.string().uuid().nullable(),
    expectedRevision: z.number().int().positive().nullable().default(null),
  })
  .strict();
export type SetComposeSignatureDefaultInput = z.infer<
  typeof setComposeSignatureDefaultInputSchema
>;

export const mailboxComposeStyleSchema = z.object({
  mailboxId: z.string().uuid(),
  customCss: z.string(),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
export type MailboxComposeStyle = z.infer<typeof mailboxComposeStyleSchema>;

export const updateMailboxComposeStyleInputSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    customCss: z.string().max(32 * 1024),
  })
  .strict();
export type UpdateMailboxComposeStyleInput = z.infer<
  typeof updateMailboxComposeStyleInputSchema
>;

export const draftLeaseHolderSchema = z.object({
  kind: z.enum(["user", "service_account"]),
  id: z.string().uuid(),
  displayName: z.string(),
  avatarHash: z.string().nullable(),
});
export type DraftLeaseHolder = z.infer<typeof draftLeaseHolderSchema>;

export const draftLeaseSchema = z.object({
  holder: draftLeaseHolderSchema,
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type DraftLease = z.infer<typeof draftLeaseSchema>;

export const acquiredDraftLeaseSchema = draftLeaseSchema.extend({
  token: z.string().uuid(),
});
export type AcquiredDraftLease = z.infer<typeof acquiredDraftLeaseSchema>;

export const senderAuthenticationPolicySchema = z.object({
  automation: z.enum(["disabled", "mailbox"]),
});
export type SenderAuthenticationPolicy = z.infer<
  typeof senderAuthenticationPolicySchema
>;

export const mailAddressSchema = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  address: z.string().email().max(320),
});
export type MailAddress = z.infer<typeof mailAddressSchema>;

export const senderIdentitySchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid(),
  label: z.string(),
  displayName: z.string(),
  fromAddress: z.string().email(),
  replyTo: z.string().email().nullable(),
  defaultCc: z.array(mailAddressSchema),
  envelopeSender: z.string().email().nullable(),
  defaultSignatureTemplateId: z.string().uuid().nullable(),
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
  label: z.string().trim().min(1).max(200),
  displayName: z.string().trim().max(200).default(""),
  fromAddress: z.string().email().max(320),
  replyTo: z.string().email().max(320).nullable().optional(),
  defaultCc: z.array(mailAddressSchema).max(50).default([]),
  envelopeSender: z.string().email().max(320).nullable().optional(),
  defaultSignatureTemplateId: z.string().uuid().nullable().optional(),
  authenticationPolicy: senderAuthenticationPolicySchema.default({
    automation: "mailbox",
  }),
  sentFolderId: z.string().uuid().nullable().optional(),
  draftsFolderId: z.string().uuid().nullable().optional(),
  isDefault: z.boolean().optional(),
});
export type CreateSenderIdentityInput = z.infer<
  typeof createSenderIdentityInputSchema
>;

export const updateSenderIdentityInputSchema = createSenderIdentityInputSchema
  .omit({ fromAddress: true })
  .extend({
    label: z.string().trim().min(1).max(200).optional(),
    displayName: z.string().trim().max(200).optional(),
    fromAddress: z.string().email().max(320).optional(),
    defaultCc: z.array(mailAddressSchema).max(50).optional(),
    authenticationPolicy: senderAuthenticationPolicySchema.optional(),
  })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one sender identity field is required"
  );
export type UpdateSenderIdentityInput = z.infer<
  typeof updateSenderIdentityInputSchema
>;

export const defaultSenderSetupInputSchema = z.object({
  bindingId: z.string().uuid(),
  label: z.string().trim().min(1).max(200).optional(),
  displayName: z.string().trim().max(200).optional(),
  savesSentAutomatically: z.boolean().default(false),
});
export type DefaultSenderSetupInput = z.infer<
  typeof defaultSenderSetupInputSchema
>;

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

export const draftIntentSchema = z.enum([
  "new",
  "reply",
  "reply_all",
  "forward",
]);
export type DraftIntent = z.infer<typeof draftIntentSchema>;
export const draftDeliveryClassSchema = z.enum(["normal", "automatic_reply"]);
export type DraftDeliveryClass = z.infer<typeof draftDeliveryClassSchema>;

const draftActorRefSchema = actorRefSchema;

export const draftSchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid(),
  conversationId: z.string().uuid().nullable(),
  intent: draftIntentSchema,
  sourceMessageId: z.string().uuid().nullable(),
  senderIdentityId: z.string().uuid(),
  to: z.array(mailAddressSchema),
  cc: z.array(mailAddressSchema),
  bcc: z.array(mailAddressSchema),
  subject: z.string(),
  body: z.string(),
  format: z.enum(["plain", "markdown"]),
  attachments: z.array(draftAttachmentSchema),
  createdBy: draftActorRefSchema,
  lastEditedBy: draftActorRefSchema,
  recoveryCopyCount: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  state: z.enum(["draft", "scheduled", "sending", "sent", "discarded"]),
  deliveryClass: draftDeliveryClassSchema,
  initialSignatureSource: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MailDraft = z.infer<typeof draftSchema>;

export type ConversationDraftSummary = Pick<
  MailDraft,
  "id" | "intent" | "subject" | "updatedAt"
> & {
  bodyPreview: string;
  createdByDisplayName: string;
};

export const scheduledSendSchema = z
  .object({
    id: z.string().uuid(),
    commandId: z.string().uuid(),
    draftId: z.string().uuid(),
    conversationId: z.string().uuid().nullable(),
    intent: draftIntentSchema,
    to: z.array(mailAddressSchema),
    cc: z.array(mailAddressSchema),
    bcc: z.array(mailAddressSchema),
    subject: z.string(),
    bodyPreview: z.string(),
    scheduledAt: z.string().datetime(),
    nextAttemptAt: z.string().datetime().nullable(),
    state: z.enum(["scheduled", "undo_window"]),
    attempt: z.number().int().nonnegative(),
    lastError: z.string().nullable(),
    scheduledBy: z.object({
      kind: z.enum(["user", "service_account", "workflow", "system"]),
      displayName: z.string(),
    }),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ScheduledSend = z.infer<typeof scheduledSendSchema>;

export const scheduledSendPageSchema = z
  .object({
    items: z.array(scheduledSendSchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type ScheduledSendPage = z.infer<typeof scheduledSendPageSchema>;

export const cancelScheduledSendInputSchema = z
  .object({ disposition: z.enum(["draft", "discard"]) })
  .strict();
export type CancelScheduledSendInput = z.infer<
  typeof cancelScheduledSendInputSchema
>;

export const cancelScheduledSendResultSchema = z
  .object({
    disposition: z.enum(["draft", "discard"]),
    draftId: z.string().uuid(),
  })
  .strict();
export type CancelScheduledSendResult = z.infer<
  typeof cancelScheduledSendResultSchema
>;

export const draftEditableContentInputSchema = z
  .object({
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
  })
  .strict();
export type DraftEditableContentInput = z.infer<
  typeof draftEditableContentInputSchema
>;

export const draftContentInputSchema = draftEditableContentInputSchema.extend({
  conversationId: z.string().uuid().nullable().optional(),
  intent: draftIntentSchema.optional(),
  sourceMessageId: z.string().uuid().nullable().optional(),
  includeSourceAttachments: z.boolean().optional(),
});
export type DraftContentInput = z.infer<typeof draftContentInputSchema>;

export const composePreviewInputSchema = z
  .object({
    draft: draftEditableContentInputSchema,
    conversationId: z.string().uuid().nullable().default(null),
  })
  .strict();
export type ComposePreviewInput = z.infer<typeof composePreviewInputSchema>;

export const composePreviewSchema = z.object({
  html: z.string(),
  text: z.string(),
});
export type ComposePreview = z.infer<typeof composePreviewSchema>;

export const renderComposeSnippetInputSchema = z
  .object({
    templateId: z.string().uuid(),
    draft: draftEditableContentInputSchema,
    conversationId: z.string().uuid().nullable().default(null),
  })
  .strict();
export type RenderComposeSnippetInput = z.infer<
  typeof renderComposeSnippetInputSchema
>;

export const composeSuggestionsInputSchema = z
  .object({
    query: z.string().trim().max(40),
    draft: draftEditableContentInputSchema,
    conversationId: z.string().uuid().nullable().default(null),
  })
  .strict();
export type ComposeSuggestionsInput = z.infer<
  typeof composeSuggestionsInputSchema
>;

export const composeSuggestionSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string(),
  shortcut: composeTemplateShortcutSchema,
  kind: composeTemplateKindSchema,
  markdown: z.string(),
});
export type ComposeSuggestion = z.infer<typeof composeSuggestionSchema>;

export const draftRecoveryCopySchema = z.object({
  id: z.string().uuid(),
  draftId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  content: draftEditableContentInputSchema,
  createdBy: draftActorRefSchema,
  createdAt: z.string().datetime(),
  restoredAt: z.string().datetime().nullable(),
  resultingRevision: z.number().int().positive().nullable(),
});
export type DraftRecoveryCopy = z.infer<typeof draftRecoveryCopySchema>;

export const MAX_DRAFT_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export const createDraftAttachmentUploadSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    contentType: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .default("application/octet-stream"),
    byteLength: z.number().int().nonnegative().max(MAX_DRAFT_ATTACHMENT_BYTES),
  })
  .strict();
export type CreateDraftAttachmentUpload = z.infer<
  typeof createDraftAttachmentUploadSchema
>;

export const draftAttachmentUploadSchema = z.object({
  id: z.string().uuid(),
  draftId: z.string().uuid(),
  filename: z.string(),
  contentType: z.string(),
  byteLength: z.number().int().nonnegative(),
  receivedBytes: z.number().int().nonnegative(),
  chunkSize: z.number().int().positive(),
  state: z.enum(["uploading", "uploaded", "attached", "cancelled"]),
  attachmentId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DraftAttachmentUpload = z.infer<typeof draftAttachmentUploadSchema>;

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

export const connectorCapabilitiesSchema = z.object({
  idle: z.boolean(),
  condstore: z.boolean(),
  qresync: z.boolean(),
  move: z.boolean(),
  uidplus: z.boolean(),
  namespace: z.boolean(),
  listExtended: z.boolean(),
  specialUse: z.boolean(),
  acl: z.boolean(),
  notify: z.boolean(),
  quota: z.boolean().default(false),
  gmailExtensions: z.boolean(),
});
export type ConnectorCapabilities = z.infer<typeof connectorCapabilitiesSchema>;

export const EMPTY_CONNECTOR_CAPABILITIES: ConnectorCapabilities = {
  idle: false,
  condstore: false,
  qresync: false,
  move: false,
  uidplus: false,
  namespace: false,
  listExtended: false,
  specialUse: false,
  acl: false,
  notify: false,
  quota: false,
  gmailExtensions: false,
};

export const parseConnectorCapabilities = (
  value: unknown
): ConnectorCapabilities => {
  const parsed = connectorCapabilitiesSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_CONNECTOR_CAPABILITIES;
};

export type ConnectorVerification = {
  authenticatedPrincipal: string;
  serverIdentity: Record<string, unknown>;
  capabilities: ConnectorCapabilities;
  accounts: RemoteAccount[];
};
