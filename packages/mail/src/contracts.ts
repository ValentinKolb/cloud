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

export const commandKindSchema = z.enum(["set_flags", "move", "copy", "delete", "send", "sync_folder", "discover_folders"]);
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

export const actorCommandInputSchema = z.discriminatedUnion("kind", [
  actorCommandBaseSchema.extend({
    kind: z.literal("set_flags"),
    remoteMessageRefId: z.string().uuid(),
    folderId: z.string().uuid(),
    flags: z.array(z.string().trim().min(1).max(100)).max(100),
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
    kind: z.literal("send"),
    draftId: z.string().uuid(),
    senderIdentityId: z.string().uuid(),
    scheduledAt: z.string().datetime().optional(),
    undoSeconds: z.number().int().min(0).max(60).default(10),
  }),
]);
export type ActorCommandInput = z.infer<typeof actorCommandInputSchema>;

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

export const mailAddressSchema = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  address: z.string().email().max(320),
});
export type MailAddress = z.infer<typeof mailAddressSchema>;

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
