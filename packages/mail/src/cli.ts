import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { basename } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  arg,
  type CloudCliContext,
  command,
  confirmFlag,
  createAccessCommands,
  defineCliCommands,
  flag,
  readCliInput,
} from "@valentinkolb/cloud/cli";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";
import { z } from "zod";
import {
  type AcquiredDraftLease,
  type DraftAttachmentUpload,
  type DraftIntent,
  type DraftLease,
  type DraftRecoveryCopy,
  type Mailbox,
  type MailboxHealth,
  type MailboxOperationalHealth,
  type MailCommand,
  type MailDraft,
  type MailSearchExpression,
  type MailWorkflow,
  type MailWorkflowDetail,
  type MailWorkflowPreflight,
  type MailWorkflowRun,
  type MailWorkflowRunTarget,
  type MailWorkflowVersion,
  mailSearchExpressionSchema,
  type ProviderBinding,
  type ProviderConnection,
  type SavedConversationViewFilter,
  type SenderIdentity,
  savedConversationViewFilterSchema,
  type WorkflowEffectBudget,
  type WorkflowTargetQuery,
  type WorkflowValidation,
  workflowTargetQuerySchema,
} from "./contracts";
import type { ConversationCollaboration, ConversationComment, MailActivityEvent, MailAssignableUser } from "./service/collaboration";
import type { MergeConversationsResult, SplitConversationResult } from "./service/conversations";
import type { ConversationSummary, MailFolderView, MessageDetail, MessageSummary } from "./service/messages";
import type { ConversationReminder } from "./service/reminders";
import type { SavedConversationView } from "./service/saved-views";
import type { MessageSearchHit, MessageSearchPage } from "./service/search";

type MailboxWithPermission = Mailbox & { permission: PermissionLevel };
type ProviderConnectionResult = { connection: ProviderConnection; verification: unknown };
type ProviderBindingResult = { binding: ProviderBinding; requiresConfirmation: boolean; comparisonReason: string };

const DEFAULT_MAILBOX_KEY = "mail.mailbox";
const DEFAULT_WAIT_TIMEOUT_SECONDS = 120;
const MAILBOX_HEALTHS = [
  "disconnected",
  "verifying",
  "bootstrapping",
  "active",
  "auth_required",
  "degraded",
  "reconnecting",
  "connection_required",
  "paused",
] as const satisfies readonly MailboxHealth[];
const COMMAND_PENDING_STATES = new Set<MailCommand["state"]>(["queued", "executing", "ambiguous"]);
const COMMAND_SUCCESS_STATES = new Set<MailCommand["state"]>(["confirmed", "reconciled"]);
const MAILBOX_FAILURE_HEALTHS = new Set<MailboxHealth>(["auth_required", "degraded", "connection_required", "paused"]);
const WORKFLOW_TERMINAL_STATES = new Set<MailWorkflowRun["state"]>(["succeeded", "failed", "canceled", "needs_attention"]);
const apiPath = (path = "") => `/api/mail${path}`;
const readApi = async <T>(ctx: CloudCliContext, path: string, init?: RequestInit): Promise<T> =>
  ctx.readJson<T>(await ctx.fetch(apiPath(path), init));
const jsonRequest = (method: string, value: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
const workflowRunRequest = (value: unknown): RequestInit => jsonRequest("POST", value);
const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const offsetDateTimeSchema = z.iso.datetime({ offset: true });
const parseOffsetDateTime = (value: string, flagName: string): string => {
  if (!offsetDateTimeSchema.safeParse(value).success) {
    throw new Error(`${flagName} must be an ISO date-time with a UTC offset, for example 2026-08-01T12:00:00Z.`);
  }
  return new Date(value).toISOString();
};

const streamResponseToFile = async (response: Response, path: string): Promise<number> => {
  if (!response.body) throw new Error("Attachment download returned an empty response body.");
  const temporaryPath = `${path}.cld-${crypto.randomUUID()}.part`;
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      callback(null, chunk);
    },
  });
  try {
    await pipeline(response.body, counter, createWriteStream(temporaryPath, { mode: 0o600 }));
    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
    if (contentLength !== null && Number.isSafeInteger(contentLength) && contentLength >= 0 && bytes !== contentLength) {
      throw new Error(`Attachment download was incomplete: expected ${contentLength} bytes, received ${bytes}.`);
    }
    await rename(temporaryPath, path);
    return bytes;
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

const waitFlags = {
  timeoutSeconds: flag.int({
    name: "timeout-seconds",
    min: 1,
    max: 3_600,
    default: DEFAULT_WAIT_TIMEOUT_SECONDS,
    description: "Maximum wait time in seconds",
  }),
};

const workflowEffectBudgetFlags = {
  maxTargets: flag.int({ name: "max-targets", min: 1, max: 50_000, default: 1_000, description: "Maximum targets per run" }),
  maxMoves: flag.int({ name: "max-moves", min: 0, max: 50_000, default: 1_000, description: "Maximum move effects per run" }),
  maxKeywordChanges: flag.int({
    name: "max-keyword-changes",
    min: 0,
    max: 100_000,
    default: 2_000,
    description: "Maximum keyword changes per run",
  }),
  maxCollaborationChanges: flag.int({
    name: "max-collaboration-changes",
    min: 0,
    max: 100_000,
    default: 2_000,
    description: "Maximum collaboration changes per run",
  }),
};

const workflowEffectBudget = (flags: {
  maxTargets?: number;
  maxMoves?: number;
  maxKeywordChanges?: number;
  maxCollaborationChanges?: number;
}): WorkflowEffectBudget => ({
  maxTargets: flags.maxTargets ?? 1_000,
  maxMoves: flags.maxMoves ?? 1_000,
  maxKeywordChanges: flags.maxKeywordChanges ?? 2_000,
  maxCollaborationChanges: flags.maxCollaborationChanges ?? 2_000,
});

const pollUntil = async <T>(params: {
  load: (signal: AbortSignal) => Promise<T>;
  done: (value: T) => boolean;
  timeoutSeconds: number | undefined;
  description: string;
}): Promise<T> => {
  const timeoutMs = (params.timeoutSeconds ?? DEFAULT_WAIT_TIMEOUT_SECONDS) * 1_000;
  const deadline = Date.now() + timeoutMs;
  const pollIntervalMs = Math.min(1_000, Math.max(100, Math.floor(timeoutMs / 20)));
  const timeoutError = () => new Error(`Timed out waiting for ${params.description}.`);
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remaining);
    let value: T;
    try {
      value = await params.load(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw timeoutError();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (params.done(value)) return value;
    if (Date.now() >= deadline) throw timeoutError();
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()))));
  }
};

const printTable = <T extends Record<string, unknown>>(
  ctx: CloudCliContext,
  value: unknown,
  rows: T[],
  columns: Parameters<CloudCliContext["table"]>[1],
) => {
  if (ctx.options.output === "json") ctx.json(value);
  else if (ctx.options.output === "jsonl") {
    for (const item of Array.isArray(value) ? value : [value]) ctx.jsonLine(item);
  } else ctx.table(rows, columns);
};

const printStructured = (ctx: CloudCliContext, value: unknown): boolean => {
  if (ctx.options.output === "json") ctx.json(value);
  else if (ctx.options.output === "jsonl") ctx.jsonLine(value);
  else return false;
  return true;
};

const listMailboxes = (ctx: CloudCliContext): Promise<MailboxWithPermission[]> => readApi(ctx, "/mailboxes?limit=200");
const getMailbox = (ctx: CloudCliContext, mailboxId: string, signal?: AbortSignal): Promise<Mailbox> =>
  readApi(ctx, `/mailboxes/${mailboxId}`, { signal });

const resolveMailbox = async (ctx: CloudCliContext, ref?: string): Promise<MailboxWithPermission> => {
  const effectiveRef = ref ?? (await ctx.getDefault(DEFAULT_MAILBOX_KEY));
  if (!effectiveRef) throw new Error("Missing mailbox. Pass a mailbox or run `cld mail use <mailbox>`. ");
  const mailboxes = await listMailboxes(ctx);
  if (isUuid(effectiveRef)) {
    const match = mailboxes.find((mailbox) => mailbox.id === effectiveRef);
    if (match) return match;
  }
  const exact = mailboxes.filter((mailbox) => mailbox.name === effectiveRef);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new Error(`Mailbox "${effectiveRef}" is ambiguous; use its id.`);
  throw new Error(`Mailbox "${effectiveRef}" was not found.`);
};

const mailboxFlag = { mailbox: flag.string({ description: "Mailbox id or exact name; defaults to `cld mail use`" }) };

const workflowSourceInput = flag.input({
  required: true,
  fileName: "source-file",
  stdinName: "source-stdin",
  description: "Exact canonical workflow YAML source",
});
const workflowQueryInput = flag.input({
  fileName: "query-file",
  stdinName: "query-stdin",
  description: "Optional target query as JSON or YAML; defaults to all messages",
});
const workflowInputsInput = flag.input({
  fileName: "inputs-file",
  stdinName: "inputs-stdin",
  description: "Optional invocation inputs as JSON or YAML; defaults to an empty object",
});
const savedViewFilterInput = flag.input({
  fileName: "filter-file",
  stdinName: "filter-stdin",
  description: "Saved view filter as JSON or YAML",
});

const parseStructuredDocument = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    try {
      return Bun.YAML.parse(value);
    } catch {
      throw new Error(`${label} must be valid JSON or YAML.`);
    }
  }
};

const readWorkflowSource = async (input: Parameters<typeof readCliInput>[0]): Promise<string> => {
  const source = await readCliInput(input, { label: "workflow source", required: true });
  if (source === undefined || source.trim().length === 0) throw new Error("Workflow source cannot be empty.");
  return source;
};

const readWorkflowQuery = async (input: Parameters<typeof readCliInput>[0]): Promise<WorkflowTargetQuery> => {
  const raw = await readCliInput(input, { label: "workflow target query", required: false });
  if (raw === undefined) return { type: "all" };
  if (raw.trim().length === 0) throw new Error("Workflow target query cannot be empty.");
  const parsed = workflowTargetQuerySchema.safeParse(parseStructuredDocument(raw, "Workflow target query"));
  if (!parsed.success) throw new Error(`Invalid workflow target query: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  return parsed.data;
};

const readWorkflowInputs = async (input: Parameters<typeof readCliInput>[0]): Promise<Record<string, unknown>> => {
  const raw = await readCliInput(input, { label: "workflow inputs", required: false });
  if (raw === undefined) return {};
  if (raw.trim().length === 0) throw new Error("Workflow inputs cannot be empty.");
  const parsed = z.record(z.string(), z.json()).safeParse(parseStructuredDocument(raw, "Workflow inputs"));
  if (!parsed.success) throw new Error(`Invalid workflow inputs: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  return parsed.data;
};

const readSavedViewFilter = async (
  input: Parameters<typeof readCliInput>[0],
  required: boolean,
): Promise<SavedConversationViewFilter | undefined> => {
  const raw = await readCliInput(input, { label: "saved view filter", required });
  if (raw === undefined) return undefined;
  if (raw.trim().length === 0) throw new Error("Saved view filter cannot be empty.");
  const parsed = savedConversationViewFilterSchema.safeParse(parseStructuredDocument(raw, "Saved view filter"));
  if (!parsed.success) throw new Error(`Invalid saved view filter: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  return parsed.data;
};

const printWorkflowPreflight = (ctx: CloudCliContext, preflight: MailWorkflowPreflight): void => {
  if (printStructured(ctx, preflight)) return;
  ctx.print(`Version: ${preflight.workflowVersionId}; source hash: ${preflight.sourceHash}`);
  ctx.print(`Targets: ${preflight.targetCount}; preflight hash: ${preflight.preflightHash}`);
};

const workflowProgressText = (run: MailWorkflowRun): string =>
  `${run.targetProgress.succeeded}/${run.targetProgress.total} succeeded; ${run.targetProgress.failed} failed; ${run.targetProgress.needs_attention} need attention`;

const workflowLastErrorText = (run: MailWorkflowRun): string => (run.lastError ? ` - ${run.lastError.code}: ${run.lastError.message}` : "");

const workflowTerminalError = (run: MailWorkflowRun) =>
  run.lastError ?? {
    code: `WORKFLOW_RUN_${run.state.toUpperCase()}`,
    message: `Workflow run ended in ${run.state}.`,
    retryable: false,
  };

const printWorkflowWaitFailure = (ctx: CloudCliContext, run: MailWorkflowRun, value: Record<string, unknown> = { run }): number => {
  const error = workflowTerminalError(run);
  if (ctx.options.output === "json") ctx.json({ ...value, error });
  else if (ctx.options.output === "jsonl") ctx.jsonLine({ ...value, error });
  else ctx.error(`Workflow run ${run.id} ended in ${run.state} - ${error.code}: ${error.message}`);
  return 1;
};

const waitForWorkflowRun = async (
  ctx: CloudCliContext,
  mailboxId: string,
  runId: string,
  timeoutSeconds?: number,
): Promise<MailWorkflowRun> => {
  const run = await pollUntil({
    load: (signal) => readApi<MailWorkflowRun>(ctx, `/mailboxes/${mailboxId}/workflow-runs/${runId}`, { signal }),
    done: (value) => WORKFLOW_TERMINAL_STATES.has(value.state),
    timeoutSeconds,
    description: `workflow run ${runId}`,
  });
  return run;
};

const mailboxAccessCommands = createAccessCommands({
  resourceLabel: "mailbox",
  resourceArgLabel: "mailbox",
  resourceArgDescription: "Optional mailbox id or exact name.",
  resolveResource: async (ctx, args) => {
    const mailbox = await resolveMailbox(ctx, args[0]);
    return { id: mailbox.id, label: `${mailbox.name} (${mailbox.id})` };
  },
  list: (ctx, mailbox) => readApi<AccessEntry[]>(ctx, `/mailboxes/${mailbox.id}/access`),
  grant: (ctx, mailbox, principal: Principal, permission: PermissionLevel) =>
    readApi<AccessEntry>(ctx, `/mailboxes/${mailbox.id}/access`, jsonRequest("POST", { principal, permission })),
  update: async (ctx, mailbox, accessId, permission) => {
    await readApi(ctx, `/mailboxes/${mailbox.id}/access/${accessId}`, jsonRequest("PATCH", { permission }));
  },
  revoke: async (ctx, mailbox, accessId) => {
    await readApi(ctx, `/mailboxes/${mailbox.id}/access/${accessId}`, { method: "DELETE" });
  },
});

const parsePort = (value: number | undefined, fallback: number): number => value ?? fallback;
const parseAddresses = (values: string[]): Array<{ name: null; address: string }> =>
  values.map((address) => ({ name: null, address: address.trim().toLowerCase() }));

const draftEditableContentFlags = {
  identity: flag.string({ required: true, description: "Sender identity id" }),
  to: flag.stringList({ description: "Recipient; repeatable" }),
  cc: flag.stringList({ description: "Cc recipient; repeatable" }),
  bcc: flag.stringList({ description: "Bcc recipient; repeatable" }),
  subject: flag.string({ description: "Message subject" }),
  body: flag.input({ required: true, fileName: "body-file", stdinName: "body-stdin", description: "Plaintext or Markdown body" }),
  format: flag.enum(["plain", "markdown"] as const, { default: "markdown" }),
};

const draftContentFlags = {
  ...draftEditableContentFlags,
  conversation: flag.string({ description: "Conversation id for reply or forward drafts" }),
  intent: flag.enum(["new", "reply", "reply_all", "forward"] as const, { description: "Immutable draft intent" }),
  sourceMessage: flag.string({ name: "source-message", description: "Source message id for reply or forward drafts" }),
};

const readDraftEditableContent = async (flags: {
  identity?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject?: string;
  body: Parameters<typeof readCliInput>[0];
  format?: "plain" | "markdown";
}) => {
  if (!flags.identity) throw new Error("Missing sender identity.");
  const body = await readCliInput(flags.body, { label: "message body", required: true });
  return {
    senderIdentityId: flags.identity,
    to: parseAddresses(flags.to),
    cc: parseAddresses(flags.cc),
    bcc: parseAddresses(flags.bcc),
    subject: flags.subject ?? "",
    body: body ?? "",
    format: flags.format ?? "markdown",
  };
};

const readDraftContent = async (
  flags: Parameters<typeof readDraftEditableContent>[0] & {
    conversation?: string;
    intent?: DraftIntent;
    sourceMessage?: string;
  },
) => ({
  ...(await readDraftEditableContent(flags)),
  conversationId: flags.conversation,
  intent: flags.intent,
  sourceMessageId: flags.sourceMessage,
});

const createDraft = async (ctx: CloudCliContext, mailboxId: string, flags: Parameters<typeof readDraftContent>[0]): Promise<MailDraft> =>
  readApi(ctx, `/mailboxes/${mailboxId}/drafts`, jsonRequest("POST", await readDraftContent(flags)));

const uploadDraftAttachment = async (params: {
  ctx: CloudCliContext;
  mailboxId: string;
  draftId: string;
  expectedRevision: number;
  path: string;
  filename?: string;
  contentType?: string;
  uploadId?: string;
}): Promise<MailDraft> => {
  const file = Bun.file(params.path);
  if (!(await file.exists())) throw new Error(`Attachment file was not found: ${params.path}`);
  const uploadBase = `/mailboxes/${params.mailboxId}/drafts/${params.draftId}/attachment-uploads`;
  let upload = params.uploadId
    ? await readApi<DraftAttachmentUpload>(params.ctx, `${uploadBase}/${params.uploadId}`)
    : await readApi<DraftAttachmentUpload>(
        params.ctx,
        uploadBase,
        jsonRequest("POST", {
          filename: params.filename ?? basename(params.path),
          contentType: params.contentType || file.type || "application/octet-stream",
          byteLength: file.size,
        }),
      );
  if (upload.byteLength !== file.size)
    throw new Error(`Upload ${upload.id} expects ${upload.byteLength} bytes, but the local file has ${file.size}.`);
  while (upload.receivedBytes < upload.byteLength) {
    const end = Math.min(upload.receivedBytes + upload.chunkSize, upload.byteLength);
    const bytes = await file.slice(upload.receivedBytes, end).arrayBuffer();
    const response = await params.ctx.fetch(apiPath(`${uploadBase}/${upload.id}?offset=${upload.receivedBytes}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    upload = await params.ctx.readJson<DraftAttachmentUpload>(response);
  }
  return readApi<MailDraft>(
    params.ctx,
    `${uploadBase}/${upload.id}/finalize`,
    jsonRequest("POST", { expectedRevision: params.expectedRevision }),
  );
};

const providerConnectionFlags = {
  name: flag.string({ required: true, description: "Connection label" }),
  email: flag.string({ required: true }),
  username: flag.string({ required: true }),
  imapHost: flag.string({ name: "imap-host", required: true }),
  imapPort: flag.int({ name: "imap-port", min: 1, max: 65_535 }),
  imapTls: flag.enum(["implicit", "starttls"] as const, { name: "imap-tls", default: "implicit" }),
  smtpHost: flag.string({ name: "smtp-host", required: true }),
  smtpPort: flag.int({ name: "smtp-port", min: 1, max: 65_535 }),
  smtpTls: flag.enum(["implicit", "starttls"] as const, { name: "smtp-tls", default: "starttls" }),
  secret: flag.input({
    required: true,
    stdinName: "secret-stdin",
    fileName: "secret-file",
    description: "Provider password or OAuth JSON; use stdin/file to avoid shell history",
  }),
  oauth2: flag.boolean({ description: "Interpret secret input as OAuth2 JSON" }),
};

const providerConnectionInput = async (flags: {
  name?: string;
  email?: string;
  username?: string;
  imapHost?: string;
  imapPort?: number;
  imapTls?: "implicit" | "starttls";
  smtpHost?: string;
  smtpPort?: number;
  smtpTls?: "implicit" | "starttls";
  secret: Parameters<typeof readCliInput>[0];
  oauth2: boolean;
}) => {
  if (!flags.name || !flags.email || !flags.username || !flags.imapHost || !flags.smtpHost) {
    throw new Error("Provider name, email, username, IMAP host, and SMTP host are required.");
  }
  const secretInput = await readCliInput(flags.secret, { label: "provider secret", required: true });
  if (!secretInput) throw new Error("Provider secret is empty.");
  const imapTls = flags.imapTls ?? "implicit";
  const smtpTls = flags.smtpTls ?? "starttls";
  return {
    name: flags.name,
    email: flags.email,
    username: flags.username,
    imap: { host: flags.imapHost, port: parsePort(flags.imapPort, imapTls === "implicit" ? 993 : 143), tlsMode: imapTls },
    smtp: { host: flags.smtpHost, port: parsePort(flags.smtpPort, smtpTls === "implicit" ? 465 : 587), tlsMode: smtpTls },
    secret: flags.oauth2 ? { kind: "oauth2" as const, ...JSON.parse(secretInput) } : { kind: "password" as const, password: secretInput },
  };
};

const commandResult = async (
  ctx: CloudCliContext,
  mailbox: Mailbox,
  input: Record<string, unknown>,
  options?: { wait?: boolean; timeoutSeconds?: number; label?: string },
): Promise<MailCommand> => {
  const queued = await readApi<MailCommand>(ctx, `/mailboxes/${mailbox.id}/commands`, jsonRequest("POST", input));
  const result = options?.wait ? await waitForCommand(ctx, mailbox.id, queued.id, options.timeoutSeconds) : queued;
  if (ctx.options.output === "json") ctx.json(result);
  else ctx.print(`${options?.label ?? result.kind}: ${result.state} (${result.id}).`);
  return result;
};

const loadCommand = (ctx: CloudCliContext, mailboxId: string, commandId: string, signal?: AbortSignal): Promise<MailCommand> =>
  readApi(ctx, `/mailboxes/${mailboxId}/commands/${commandId}`, { signal });

const waitForCommand = async (
  ctx: CloudCliContext,
  mailboxId: string,
  commandId: string,
  timeoutSeconds?: number,
): Promise<MailCommand> => {
  const result = await pollUntil({
    load: (signal) => loadCommand(ctx, mailboxId, commandId, signal),
    done: (value) => !COMMAND_PENDING_STATES.has(value.state),
    timeoutSeconds,
    description: `mail command ${commandId}`,
  });
  if (!COMMAND_SUCCESS_STATES.has(result.state)) {
    throw new Error(`Mail command ${result.id} ended in ${result.state}${result.lastError ? `: ${result.lastError}` : "."}`);
  }
  return result;
};

const waitForCommands = async (
  ctx: CloudCliContext,
  mailboxId: string,
  commandIds: string[],
  timeoutSeconds?: number,
): Promise<MailCommand[]> => {
  const commands = await pollUntil({
    load: (signal) => Promise.all(commandIds.map((commandId) => loadCommand(ctx, mailboxId, commandId, signal))),
    done: (values) => values.every((value) => !COMMAND_PENDING_STATES.has(value.state)),
    timeoutSeconds,
    description: `${commandIds.length} mail commands`,
  });
  const failed = commands.find((command) => !COMMAND_SUCCESS_STATES.has(command.state));
  if (failed) throw new Error(`Mail command ${failed.id} ended in ${failed.state}${failed.lastError ? `: ${failed.lastError}` : "."}`);
  return commands;
};

const searchTermFlags = {
  any: flag.stringList({ description: "Search all indexed fields; repeatable" }),
  subject: flag.stringList({ description: "Search subject; repeatable" }),
  body: flag.stringList({ description: "Search body; repeatable" }),
  from: flag.stringList({ description: "Search sender; repeatable" }),
  to: flag.stringList({ description: "Search recipient; repeatable" }),
  cc: flag.stringList({ description: "Search Cc recipient; repeatable" }),
  bcc: flag.stringList({ description: "Search Bcc recipient; repeatable" }),
  messageId: flag.stringList({ name: "message-id", description: "Search Message-ID; repeatable" }),
  or: flag.boolean({ description: "OR terms instead of AND" }),
  match: flag.enum(["words", "phrase", "contains", "exact"] as const, { default: "words", description: "Term matching mode" }),
  expression: flag.input({
    fileName: "expression-file",
    stdinName: "expression-stdin",
    description: "Nested search expression JSON; cannot be combined with term flags",
  }),
};

const searchFlags = {
  ...mailboxFlag,
  ...searchTermFlags,
  sort: flag.enum(["relevance", "newest"] as const, { default: "relevance" }),
  cursor: flag.string({ description: "Opaque cursor returned by a previous search" }),
  limit: flag.int({ min: 1, max: 100, default: 50 }),
};

const mutationFlags = {
  ...mailboxFlag,
  idempotencyKey: flag.string({ name: "idempotency-key", description: "Stable client retry key" }),
  correlationId: flag.string({ name: "correlation-id", description: "Optional external operation id" }),
};

const printCollaboration = (ctx: CloudCliContext, value: ConversationCollaboration): void => {
  if (ctx.options.output === "json") return ctx.json(value);
  ctx.print(`Conversation: ${value.conversationId}`);
  ctx.print(`Revision: ${value.revision}`);
  ctx.print(`Status: ${value.workStatus}`);
  ctx.print(`Assignee: ${value.assignee ? `${value.assignee.displayName} (${value.assignee.id})` : "unassigned"}`);
  ctx.print(`Response needed: ${value.responseNeeded ? "yes" : "no"}`);
  ctx.print(`Snoozed until: ${value.snoozedUntil ?? "not snoozed"}`);
  ctx.print(`Watchers: ${value.watchers.map((watcher) => watcher.displayName).join(", ") || "none"}`);
};

const collaborationPath = (mailboxId: string, conversationId: string): string =>
  `/mailboxes/${mailboxId}/conversations/${conversationId}/collaboration`;

const printCollaborators = (ctx: CloudCliContext, users: MailAssignableUser[]): void =>
  printTable(
    ctx,
    users,
    users.map((user) => ({ name: user.displayName, permission: user.permission, access: user.description, id: user.id })),
    [
      { key: "name", label: "NAME" },
      { key: "permission", label: "PERMISSION" },
      { key: "access", label: "ACCESS" },
      { key: "id", label: "USER ID" },
    ],
  );

type SearchTermFlagValues = {
  any: string[];
  subject: string[];
  body: string[];
  from: string[];
  to: string[];
  cc: string[];
  bcc: string[];
  messageId: string[];
  or: boolean;
  match: "words" | "phrase" | "contains" | "exact" | undefined;
  expression: Parameters<typeof readCliInput>[0];
};

const buildSimpleSearchExpression = (flags: SearchTermFlagValues): MailSearchExpression => {
  const terms: MailSearchExpression[] = [];
  const fields = [
    ["any", "any"],
    ["subject", "subject"],
    ["body", "body"],
    ["from", "from"],
    ["to", "to"],
    ["cc", "cc"],
    ["bcc", "bcc"],
    ["messageId", "message_id"],
  ] as const;
  for (const [flagName, field] of fields) {
    for (const query of flags[flagName]) terms.push({ field, query, match: flags.match ?? "words" });
  }
  if (terms.length === 0) throw new Error("Pass at least one search term such as --any, --subject, --body, or --from.");
  return terms.length === 1 ? terms[0]! : flags.or ? { or: terms } : { and: terms };
};

const resolveSearchExpression = async (flags: SearchTermFlagValues): Promise<MailSearchExpression> => {
  const input = await readCliInput(flags.expression, { label: "search expression", trimFinalNewline: true });
  if (!input) return buildSimpleSearchExpression(flags);
  if (
    [flags.any, flags.subject, flags.body, flags.from, flags.to, flags.cc, flags.bcc, flags.messageId].some((values) => values.length > 0)
  ) {
    throw new Error("Search expression input cannot be combined with term flags.");
  }
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("Search expression must be valid JSON.");
  }
  const parsed = mailSearchExpressionSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid search expression: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  return parsed.data;
};

const searchMessages = async (
  ctx: CloudCliContext,
  mailboxId: string,
  request: { expression: MailSearchExpression; sort?: "relevance" | "newest"; cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<MessageSearchPage> => readApi(ctx, `/mailboxes/${mailboxId}/search`, { ...jsonRequest("POST", request), signal });

const submitMessageState = (
  ctx: CloudCliContext,
  mailbox: Mailbox,
  remoteMessageRefId: string,
  folderId: string,
  change: Record<string, unknown>,
  flags: { idempotencyKey?: string; correlationId?: string; wait: boolean; timeoutSeconds?: number },
): Promise<MailCommand> =>
  commandResult(
    ctx,
    mailbox,
    {
      kind: "change_message_state",
      remoteMessageRefId,
      folderId,
      change,
      idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
      correlationId: flags.correlationId,
    },
    { wait: flags.wait, timeoutSeconds: flags.timeoutSeconds, label: "Message state" },
  );

const submitConversationAction = async (params: {
  ctx: CloudCliContext;
  mailbox: Mailbox;
  conversationId: string;
  input: Record<string, unknown>;
  wait: boolean;
  timeoutSeconds?: number;
}): Promise<void> => {
  const result = await readApi<{ correlationId: string; commands: MailCommand[] }>(
    params.ctx,
    `/mailboxes/${params.mailbox.id}/conversations/${params.conversationId}/actions`,
    jsonRequest("POST", params.input),
  );
  const commands = params.wait
    ? await waitForCommands(
        params.ctx,
        params.mailbox.id,
        result.commands.map((item) => item.id),
        params.timeoutSeconds,
      )
    : result.commands;
  const output = { correlationId: result.correlationId, commands };
  if (params.ctx.options.output === "json") params.ctx.json(output);
  else
    params.ctx.print(
      `${commands.length} conversation message command${commands.length === 1 ? "" : "s"} ${params.wait ? "completed" : "queued"}.`,
    );
};

const stateMutationFlags = {
  ...mutationFlags,
  folder: flag.string({ required: true, description: "Source folder id" }),
  wait: flag.boolean({ description: "Wait for provider confirmation" }),
  ...waitFlags,
};

const conversationMutationFlags = {
  ...mutationFlags,
  source: flag.string({ required: true, description: "Source folder id" }),
  wait: flag.boolean({ description: "Wait for every provider mutation" }),
  ...waitFlags,
};

const conversationActionCommand = (
  path: string,
  summary: string,
  action: { kind: "change_state"; change: Record<string, unknown> } | { kind: "move_to_role"; role: "archive" | "trash" | "junk" },
) =>
  command(path, {
    summary,
    args: { conversationId: arg.required({ description: "Conversation id" }) },
    flags: conversationMutationFlags,
    run: async ({ ctx, args, flags }) => {
      const mailbox = await resolveMailbox(ctx, flags.mailbox);
      await submitConversationAction({
        ctx,
        mailbox,
        conversationId: args.conversationId,
        input: {
          ...action,
          sourceFolderId: flags.source,
          idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
          correlationId: flags.correlationId,
        },
        wait: flags.wait,
        timeoutSeconds: flags.timeoutSeconds,
      });
    },
  });

const folderSubscriptionCommand = (path: "folder subscribe" | "folder unsubscribe", subscribed: boolean) =>
  command(path, {
    summary: `${subscribed ? "Subscribe" : "Unsubscribe"} a provider folder`,
    args: { folderId: arg.required({ description: "Canonical folder id" }) },
    flags: { ...mutationFlags, wait: flag.boolean(), ...waitFlags },
    run: async ({ ctx, args, flags }) => {
      const mailbox = await resolveMailbox(ctx, flags.mailbox);
      await commandResult(
        ctx,
        mailbox,
        {
          kind: "set_folder_subscription",
          folderId: args.folderId,
          subscribed,
          idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
          correlationId: flags.correlationId,
        },
        { wait: flags.wait, timeoutSeconds: flags.timeoutSeconds, label: "Folder subscription" },
      );
    },
  });

const messageStateCommand = (path: string, summary: string, change: Record<string, unknown>) =>
  command(path, {
    summary,
    args: { remoteMessageRefId: arg.required({ description: "Remote message reference id" }) },
    flags: stateMutationFlags,
    run: async ({ ctx, args, flags }) => {
      const mailbox = await resolveMailbox(ctx, flags.mailbox);
      await submitMessageState(ctx, mailbox, args.remoteMessageRefId, flags.folder!, change, flags);
    },
  });

const messageKeywordCommand = (path: string, summary: string, operation: "add" | "remove") =>
  command(path, {
    summary,
    args: {
      remoteMessageRefId: arg.required({ description: "Remote message reference id" }),
      keyword: arg.required({ description: "IMAP keyword" }),
    },
    flags: stateMutationFlags,
    run: async ({ ctx, args, flags }) => {
      const mailbox = await resolveMailbox(ctx, flags.mailbox);
      const change = operation === "add" ? { addKeywords: [args.keyword] } : { removeKeywords: [args.keyword] };
      await submitMessageState(ctx, mailbox, args.remoteMessageRefId, flags.folder!, change, flags);
    },
  });

const folderRole = (value: string): "sent" | "drafts" | "trash" | "archive" | "junk" => {
  if (value === "sent" || value === "drafts" || value === "trash" || value === "archive" || value === "junk") return value;
  throw new Error("Unsupported folder role.");
};

export default defineCliCommands({
  name: "mail",
  summary: "Search, read, configure, and operate Cloud Mail.",
  commands: [
    command("list", {
      summary: "List accessible mailboxes",
      run: async ({ ctx }) => {
        const mailboxes = await listMailboxes(ctx);
        printTable(
          ctx,
          mailboxes,
          mailboxes.map((mailbox) => ({
            name: mailbox.name,
            health: mailbox.health,
            permission: mailbox.permission,
            policy: mailbox.connectionPolicy,
            id: mailbox.id,
          })),
          [
            { key: "name", label: "NAME" },
            { key: "health", label: "HEALTH" },
            { key: "permission", label: "ACCESS" },
            { key: "policy", label: "CONNECTION" },
            { key: "id", label: "ID" },
          ],
        );
      },
    }),
    command("create", {
      summary: "Create a mailbox",
      args: { name: arg.required({ description: "Mailbox name" }) },
      flags: {
        description: flag.string({ description: "Mailbox description" }),
        policy: flag.enum(["shared_connection", "personal_provider_account"] as const, { default: "shared_connection" }),
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await readApi<Mailbox>(
          ctx,
          "/mailboxes",
          jsonRequest("POST", {
            name: args.name,
            description: flags.description,
            connectionPolicy: flags.policy,
          }),
        );
        if (ctx.options.output === "json") ctx.json(mailbox);
        else ctx.print(`Created ${mailbox.name} (${mailbox.id}).`);
      },
    }),
    command("use", {
      summary: "Set the default mailbox",
      args: { mailbox: arg.required({ description: "Mailbox id or exact name" }) },
      run: async ({ ctx, args }) => {
        const mailbox = await resolveMailbox(ctx, args.mailbox);
        await ctx.setDefault(DEFAULT_MAILBOX_KEY, mailbox.id);
        if (ctx.options.output === "json") ctx.json({ mailbox, defaultMailbox: mailbox.id });
        else ctx.print(`Using ${mailbox.name} (${mailbox.id}).`);
      },
    }),
    command("current", {
      summary: "Show the default mailbox",
      run: async ({ ctx }) => {
        const mailbox = await resolveMailbox(ctx);
        if (ctx.options.output === "json") ctx.json(mailbox);
        else ctx.print(`${mailbox.name} (${mailbox.id}).`);
      },
    }),
    command("mailbox get", {
      summary: "Show one mailbox",
      args: { mailbox: arg.optional({ description: "Mailbox id or exact name; defaults to `cld mail use`" }) },
      run: async ({ ctx, args }) => {
        const resolved = await resolveMailbox(ctx, args.mailbox);
        const mailbox = await getMailbox(ctx, resolved.id);
        if (ctx.options.output === "json") ctx.json({ ...mailbox, permission: resolved.permission });
        else {
          ctx.print(`${mailbox.name} (${mailbox.id})`);
          ctx.print(`Health: ${mailbox.health}${mailbox.healthReason ? ` - ${mailbox.healthReason}` : ""}`);
          ctx.print(`Access: ${resolved.permission}`);
          ctx.print(`Connection: ${mailbox.connectionPolicy}`);
          ctx.print(`Search: ${mailbox.searchBackend}`);
        }
      },
    }),
    command("mailbox wait", {
      summary: "Wait for a mailbox health state",
      args: { mailbox: arg.optional({ description: "Mailbox id or exact name; defaults to `cld mail use`" }) },
      flags: {
        health: flag.enum(MAILBOX_HEALTHS, { default: "active", description: "Target health state" }),
        ...waitFlags,
      },
      run: async ({ ctx, args, flags }) => {
        const resolved = await resolveMailbox(ctx, args.mailbox);
        const target = flags.health ?? "active";
        const mailbox = await pollUntil({
          load: (signal) => getMailbox(ctx, resolved.id, signal),
          done: (value) => value.health === target || (MAILBOX_FAILURE_HEALTHS.has(value.health) && !MAILBOX_FAILURE_HEALTHS.has(target)),
          timeoutSeconds: flags.timeoutSeconds,
          description: `${resolved.name} to become ${target}`,
        });
        if (mailbox.health !== target) {
          throw new Error(`${mailbox.name} entered ${mailbox.health}${mailbox.healthReason ? `: ${mailbox.healthReason}` : "."}`);
        }
        if (ctx.options.output === "json") ctx.json(mailbox);
        else ctx.print(`${mailbox.name}: ${mailbox.health}.`);
      },
    }),
    command("configure", {
      summary: "Update mailbox identity or search ranking",
      flags: {
        ...mailboxFlag,
        name: flag.string({ description: "New mailbox name" }),
        description: flag.string({ description: "New mailbox description; pass an empty value to clear" }),
        searchBackend: flag.enum(["auto", "postgres", "pg_textsearch"] as const, {
          name: "search-backend",
          description: "Search ranking backend preference",
        }),
        sync: flag.enum(["enabled", "disabled"] as const, { description: "Enable or pause provider synchronization" }),
      },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const update = {
          ...(flags.name !== undefined ? { name: flags.name } : {}),
          ...(flags.description !== undefined ? { description: flags.description || null } : {}),
          ...(flags.searchBackend !== undefined ? { searchBackend: flags.searchBackend } : {}),
          ...(flags.sync !== undefined ? { syncEnabled: flags.sync === "enabled" } : {}),
        };
        if (Object.keys(update).length === 0) throw new Error("Pass --name, --description, --search-backend, or --sync.");
        const updated = await readApi<Mailbox>(ctx, `/mailboxes/${mailbox.id}`, jsonRequest("PATCH", update));
        if (ctx.options.output === "json") ctx.json(updated);
        else ctx.print(`Updated ${updated.name} (${updated.id}).`);
      },
    }),
    command("status", {
      summary: "Show operational mailbox health",
      flags: mailboxFlag,
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const health = await readApi<MailboxOperationalHealth>(ctx, `/mailboxes/${mailbox.id}/health`);
        if (ctx.options.output === "json") ctx.json(health);
        else {
          ctx.print(`${mailbox.name}: ${health.health}${health.healthReason ? ` - ${health.healthReason}` : ""}`);
          ctx.print(
            `Bindings: ${health.bindings.active}/${health.bindings.total} active, ${health.bindings.degraded} degraded, ${health.bindings.pending} pending`,
          );
          ctx.print(
            `Folders: ${health.discovery.activeFolders} active, ${health.discovery.missingFolders} missing, ${health.discovery.ambiguousFolders} ambiguous`,
          );
          ctx.print(
            `Sync: ${health.sync.runningRuns} running, ${health.sync.failedRuns} failed; hydration ${health.hydration.pending} pending/${health.hydration.failed} failed`,
          );
          ctx.print(`Commands: ${health.commands.maintenanceQueued} maintenance pending; search ${health.search.configuredBackend}`);
        }
      },
    }),
    command("folders", {
      summary: "List canonical folders",
      flags: mailboxFlag,
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const folders = await readApi<MailFolderView[]>(ctx, `/mailboxes/${mailbox.id}/folders`);
        printTable(
          ctx,
          folders,
          folders.map((folder) => ({
            name: folder.name,
            role: folder.role,
            namespace: folder.namespaceKinds.join(","),
            total: folder.total,
            unread: folder.unread,
            discovery: folder.discoveryState,
            status: folder.syncStatus,
            id: folder.id,
          })),
          [
            { key: "name", label: "NAME" },
            { key: "role", label: "ROLE" },
            { key: "namespace", label: "NAMESPACE" },
            { key: "total", label: "TOTAL" },
            { key: "unread", label: "UNREAD" },
            { key: "discovery", label: "DISCOVERY" },
            { key: "status", label: "SYNC" },
            { key: "id", label: "ID" },
          ],
        );
      },
    }),
    command("folder create", {
      summary: "Create and optionally subscribe a provider folder",
      args: { name: arg.required({ description: "Folder leaf name" }) },
      flags: {
        ...mutationFlags,
        parent: flag.string({ description: "Optional canonical parent folder id" }),
        noSubscribe: flag.boolean({ name: "no-subscribe", description: "Create without subscribing" }),
        wait: flag.boolean({ description: "Wait for provider confirmation and rediscovery" }),
        ...waitFlags,
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        await commandResult(
          ctx,
          mailbox,
          {
            kind: "create_folder",
            parentFolderId: flags.parent ?? null,
            name: args.name,
            subscribe: !flags.noSubscribe,
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
            correlationId: flags.correlationId,
          },
          { wait: flags.wait, timeoutSeconds: flags.timeoutSeconds, label: "Folder create" },
        );
      },
    }),
    command("folder rename", {
      summary: "Rename a provider folder",
      args: {
        folderId: arg.required({ description: "Canonical folder id" }),
        name: arg.required({ description: "New folder leaf name" }),
      },
      flags: { ...mutationFlags, wait: flag.boolean(), ...waitFlags },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        await commandResult(
          ctx,
          mailbox,
          {
            kind: "rename_folder",
            folderId: args.folderId,
            name: args.name,
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
            correlationId: flags.correlationId,
          },
          { wait: flags.wait, timeoutSeconds: flags.timeoutSeconds, label: "Folder rename" },
        );
      },
    }),
    command("folder delete", {
      summary: "Delete an empty provider folder",
      args: { folderId: arg.required({ description: "Canonical folder id" }) },
      flags: { ...mutationFlags, yes: confirmFlag("Confirm deletion of the remote folder"), wait: flag.boolean(), ...waitFlags },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Pass --yes to delete the remote folder.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        await commandResult(
          ctx,
          mailbox,
          {
            kind: "delete_folder",
            folderId: args.folderId,
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
            correlationId: flags.correlationId,
          },
          { wait: flags.wait, timeoutSeconds: flags.timeoutSeconds, label: "Folder delete" },
        );
      },
    }),
    folderSubscriptionCommand("folder subscribe", true),
    folderSubscriptionCommand("folder unsubscribe", false),
    command("folder role set", {
      summary: "Map a semantic role to one canonical folder",
      args: {
        role: arg.required({ description: "sent, drafts, trash, archive, or junk" }),
        folderId: arg.required({ description: "Canonical folder id" }),
      },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const role = folderRole(args.role);
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const result = await readApi(ctx, `/mailboxes/${mailbox.id}/folder-roles/${role}`, jsonRequest("PUT", { folderId: args.folderId }));
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Mapped ${role} to ${args.folderId}.`);
      },
    }),
    command("folder role clear", {
      summary: "Remove an explicit semantic folder mapping",
      args: { role: arg.required({ description: "sent, drafts, trash, archive, or junk" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const role = folderRole(args.role);
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        await readApi(ctx, `/mailboxes/${mailbox.id}/folder-roles/${role}`, { method: "DELETE" });
        if (ctx.options.output === "json") ctx.json({ cleared: true, role });
        else ctx.print(`Cleared the explicit ${role} folder mapping.`);
      },
    }),
    command("sync", {
      summary: "Queue durable synchronization for a mailbox",
      flags: {
        ...mutationFlags,
        wait: flag.boolean({ description: "Wait for the queueing command to finish" }),
        ...waitFlags,
      },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const command = await readApi<MailCommand>(
          ctx,
          `/mailboxes/${mailbox.id}/commands`,
          jsonRequest("POST", {
            kind: "sync_mailbox",
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
            correlationId: flags.correlationId,
          }),
        );
        const result = flags.wait ? await waitForCommand(ctx, mailbox.id, command.id, flags.timeoutSeconds) : command;
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Mailbox sync ${result.state} (${result.id}).`);
      },
    }),
    command("sync folder", {
      summary: "Queue durable synchronization for one folder",
      args: { folderId: arg.required({ description: "Canonical folder id" }) },
      flags: { ...mutationFlags, wait: flag.boolean(), ...waitFlags },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const command = await readApi<MailCommand>(
          ctx,
          `/mailboxes/${mailbox.id}/commands`,
          jsonRequest("POST", {
            kind: "sync_folder",
            folderId: args.folderId,
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
            correlationId: flags.correlationId,
          }),
        );
        const result = flags.wait ? await waitForCommand(ctx, mailbox.id, command.id, flags.timeoutSeconds) : command;
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Folder sync ${result.state} (${result.id}).`);
      },
    }),
    command("rediscover", {
      summary: "Rediscover folders, subscriptions, and effective rights",
      flags: {
        ...mutationFlags,
        binding: flag.string({ description: "Optional provider binding id; defaults to every active binding" }),
        wait: flag.boolean(),
        ...waitFlags,
      },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const command = await readApi<MailCommand>(
          ctx,
          `/mailboxes/${mailbox.id}/commands`,
          jsonRequest("POST", {
            kind: "discover_folders",
            bindingId: flags.binding,
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
            correlationId: flags.correlationId,
          }),
        );
        const result = flags.wait ? await waitForCommand(ctx, mailbox.id, command.id, flags.timeoutSeconds) : command;
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Rediscovery ${result.state} (${result.id}).`);
      },
    }),
    command("binding verify", {
      summary: "Reverify one binding after provider credentials changed",
      args: { bindingId: arg.required({ description: "Provider binding id" }) },
      flags: { ...mutationFlags, wait: flag.boolean(), ...waitFlags },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const command = await readApi<MailCommand>(
          ctx,
          `/mailboxes/${mailbox.id}/commands`,
          jsonRequest("POST", {
            kind: "verify_binding",
            bindingId: args.bindingId,
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
            correlationId: flags.correlationId,
          }),
        );
        const result = flags.wait ? await waitForCommand(ctx, mailbox.id, command.id, flags.timeoutSeconds) : command;
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Binding verification ${result.state} (${result.id}).`);
      },
    }),
    command("repair folder", {
      summary: "Rebuild one folder after remote UID identity changed",
      args: { folderId: arg.required({ description: "Canonical folder id" }) },
      flags: { ...mutationFlags, yes: confirmFlag("Confirm the local folder rebuild"), wait: flag.boolean(), ...waitFlags },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Pass --yes to rebuild the folder projection.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const command = await readApi<MailCommand>(
          ctx,
          `/mailboxes/${mailbox.id}/commands`,
          jsonRequest("POST", {
            kind: "rebuild_folder",
            folderId: args.folderId,
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
            correlationId: flags.correlationId,
          }),
        );
        const result = flags.wait ? await waitForCommand(ctx, mailbox.id, command.id, flags.timeoutSeconds) : command;
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Folder rebuild ${result.state} (${result.id}).`);
      },
    }),
    command("repair hydration", {
      summary: "Retry failed or missing message hydration",
      flags: { ...mutationFlags, wait: flag.boolean(), ...waitFlags },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const command = await readApi<MailCommand>(
          ctx,
          `/mailboxes/${mailbox.id}/commands`,
          jsonRequest("POST", {
            kind: "hydrate_missing",
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
            correlationId: flags.correlationId,
          }),
        );
        const result = flags.wait ? await waitForCommand(ctx, mailbox.id, command.id, flags.timeoutSeconds) : command;
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Hydration retry ${result.state} (${result.id}).`);
      },
    }),
    command("search", {
      summary: "Search message fields with AND or OR semantics",
      flags: searchFlags,
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const result = await searchMessages(ctx, mailbox.id, {
          expression: await resolveSearchExpression(flags),
          sort: flags.sort,
          cursor: flags.cursor,
          limit: flags.limit,
        });
        printTable(
          ctx,
          result,
          result.items.map((item) => ({
            date: item.internalDate,
            from: item.from.map((address) => address.address).join(", "),
            subject: item.subject,
            id: item.id,
          })),
          [
            { key: "date", label: "DATE" },
            { key: "from", label: "FROM" },
            { key: "subject", label: "SUBJECT" },
            { key: "id", label: "MESSAGE ID" },
          ],
        );
      },
    }),
    command("message get", {
      summary: "Read one mirrored message",
      args: { messageId: arg.required({ description: "Message content id" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const message = await readApi<MessageDetail>(ctx, `/mailboxes/${mailbox.id}/messages/${args.messageId}`);
        if (ctx.options.output === "json") ctx.json(message);
        else {
          ctx.print(`Subject: ${message.subject}`);
          ctx.print(`From: ${message.from.map((address) => address.address).join(", ")}`);
          ctx.print(`To: ${message.to.map((address) => address.address).join(", ")}`);
          ctx.print("");
          ctx.print(message.plainText ?? "[Body not hydrated]");
        }
      },
    }),
    command("message wait", {
      summary: "Wait for a mirrored message matching a search",
      flags: {
        ...mailboxFlag,
        ...searchTermFlags,
        ...waitFlags,
      },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const expression = await resolveSearchExpression(flags);
        const hit = await pollUntil<MessageSearchHit | null>({
          load: async (signal) =>
            (await searchMessages(ctx, mailbox.id, { expression, sort: "newest", limit: 1 }, signal)).items[0] ?? null,
          done: (value) => value !== null,
          timeoutSeconds: flags.timeoutSeconds,
          description: `a matching message in ${mailbox.name}`,
        });
        if (!hit) throw new Error("Matching message disappeared.");
        if (ctx.options.output === "json") ctx.json(hit);
        else ctx.print(`${hit.subject} (${hit.id}).`);
      },
    }),
    command("attachment download", {
      summary: "Download a mirrored message attachment",
      args: {
        messageId: arg.required({ description: "Message content id" }),
        attachmentId: arg.required({ description: "Attachment id" }),
      },
      flags: {
        ...mailboxFlag,
        out: flag.string({ required: true, aliases: ["output"], description: "Output file path" }),
        offset: flag.int({ min: 0, description: "Optional byte offset" }),
        length: flag.int({ min: 1, max: 4 * 1024 * 1024, description: "Optional byte count" }),
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.out) throw new Error("Missing required flag --out.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = new URLSearchParams();
        if (flags.offset !== undefined) query.set("offset", String(flags.offset));
        if (flags.length !== undefined) query.set("length", String(flags.length));
        const suffix = query.size > 0 ? `?${query}` : "";
        const response = await ctx.fetch(
          apiPath(`/mailboxes/${mailbox.id}/messages/${args.messageId}/attachments/${args.attachmentId}${suffix}`),
        );
        if (!response.ok) {
          await ctx.readJson(response);
          throw new Error(`Attachment download failed with HTTP ${response.status}.`);
        }
        const bytes = await streamResponseToFile(response, flags.out);
        const result = {
          path: flags.out,
          bytes,
          contentType: response.headers.get("content-type"),
          contentRange: response.headers.get("content-range"),
          etag: response.headers.get("etag"),
        };
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Wrote ${bytes} bytes to ${flags.out}.`);
      },
    }),
    command("message flags", {
      summary: "Replace provider flags on one remote message",
      args: { remoteMessageRefId: arg.required({ description: "Remote message reference id" }) },
      flags: {
        ...mutationFlags,
        folder: flag.string({ required: true, description: "Source folder id" }),
        flag: flag.stringList({ description: "IMAP flag; repeatable. Omit all values to clear flags." }),
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        await commandResult(ctx, mailbox, {
          kind: "set_flags",
          remoteMessageRefId: args.remoteMessageRefId,
          folderId: flags.folder,
          flags: flags.flag,
          idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
          correlationId: flags.correlationId,
        });
      },
    }),
    messageStateCommand("message read", "Mark one remote message as read without replacing other flags", { addFlags: ["seen"] }),
    messageStateCommand("message unread", "Mark one remote message as unread without replacing other flags", { removeFlags: ["seen"] }),
    messageStateCommand("message star", "Star one remote message without replacing other flags", { addFlags: ["flagged"] }),
    messageStateCommand("message unstar", "Remove the star from one remote message without replacing other flags", {
      removeFlags: ["flagged"],
    }),
    messageKeywordCommand("message keyword add", "Add one IMAP keyword without replacing other message state", "add"),
    messageKeywordCommand("message keyword remove", "Remove one IMAP keyword without replacing other message state", "remove"),
    command("message move", {
      summary: "Move one remote message",
      args: { remoteMessageRefId: arg.required({ description: "Remote message reference id" }) },
      flags: {
        ...mutationFlags,
        source: flag.string({ required: true, description: "Source folder id" }),
        destination: flag.string({ required: true, description: "Destination folder id" }),
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        await commandResult(ctx, mailbox, {
          kind: "move",
          remoteMessageRefId: args.remoteMessageRefId,
          sourceFolderId: flags.source,
          destinationFolderId: flags.destination,
          idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
          correlationId: flags.correlationId,
        });
      },
    }),
    command("message copy", {
      summary: "Copy one remote message",
      args: { remoteMessageRefId: arg.required({ description: "Remote message reference id" }) },
      flags: {
        ...mutationFlags,
        source: flag.string({ required: true, description: "Source folder id" }),
        destination: flag.string({ required: true, description: "Destination folder id" }),
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        await commandResult(ctx, mailbox, {
          kind: "copy",
          remoteMessageRefId: args.remoteMessageRefId,
          sourceFolderId: flags.source,
          destinationFolderId: flags.destination,
          idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
          correlationId: flags.correlationId,
        });
      },
    }),
    command("message delete", {
      summary: "Delete one remote message with the provider's safe UID operation",
      args: { remoteMessageRefId: arg.required({ description: "Remote message reference id" }) },
      flags: {
        ...mutationFlags,
        folder: flag.string({ required: true, description: "Source folder id" }),
        yes: confirmFlag("Confirm remote message deletion"),
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Pass --yes to delete the remote message.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        await commandResult(ctx, mailbox, {
          kind: "delete",
          remoteMessageRefId: args.remoteMessageRefId,
          folderId: flags.folder,
          idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
          correlationId: flags.correlationId,
        });
      },
    }),
    command("conversation list", {
      summary: "List recent conversations",
      flags: {
        ...mailboxFlag,
        folder: flag.string({ description: "Folder id" }),
        status: flag.enum(["open", "waiting", "done"] as const, { description: "Workflow status" }),
        view: flag.enum(["inbox", "mine", "unassigned", "waiting", "done", "snoozed", "recently_active"] as const, {
          description: "Built-in collaboration view",
        }),
        cursor: flag.string({ description: "Opaque cursor returned by a previous page" }),
        limit: flag.int({ min: 1, max: 100, default: 50 }),
      },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = new URLSearchParams({ limit: String(flags.limit ?? 50) });
        if (flags.folder) query.set("folderId", flags.folder);
        if (flags.status) query.set("status", flags.status);
        if (flags.view) query.set("view", flags.view);
        if (flags.cursor) query.set("cursor", flags.cursor);
        const page = await readApi<{ items: ConversationSummary[]; nextCursor: string | null }>(
          ctx,
          `/mailboxes/${mailbox.id}/conversations?${query}`,
        );
        printTable(
          ctx,
          page,
          page.items.map((thread) => ({
            date: thread.latestMessageAt,
            unread: thread.unread ? "yes" : "",
            status: thread.workStatus,
            participants: thread.participantSummary,
            subject: thread.subject,
            id: thread.id,
          })),
          [
            { key: "date", label: "DATE" },
            { key: "unread", label: "UNREAD" },
            { key: "status", label: "STATUS" },
            { key: "participants", label: "PARTICIPANTS" },
            { key: "subject", label: "SUBJECT" },
            { key: "id", label: "THREAD ID" },
          ],
        );
      },
    }),
    command("conversation messages", {
      summary: "List messages in one conversation",
      args: { conversationId: arg.required({ description: "Conversation id" }) },
      flags: {
        ...mailboxFlag,
        cursor: flag.string({ description: "Opaque cursor returned by a previous page" }),
        limit: flag.int({ min: 1, max: 100, default: 50 }),
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = new URLSearchParams({ limit: String(flags.limit ?? 50) });
        if (flags.cursor) query.set("cursor", flags.cursor);
        const page = await readApi<{ items: MessageSummary[]; nextCursor: string | null }>(
          ctx,
          `/mailboxes/${mailbox.id}/conversations/${args.conversationId}/messages?${query}`,
        );
        printTable(
          ctx,
          page,
          page.items.map((message) => ({
            date: message.internalDate,
            from: message.from.map((address) => address.address).join(", "),
            subject: message.subject,
            remote: message.remoteMessageRefId ?? "",
            id: message.id,
          })),
          [
            { key: "date", label: "DATE" },
            { key: "from", label: "FROM" },
            { key: "subject", label: "SUBJECT" },
            { key: "remote", label: "REMOTE REF" },
            { key: "id", label: "MESSAGE ID" },
          ],
        );
      },
    }),
    command("conversation merge", {
      summary: "Merge one conversation into another and pin the resulting thread",
      args: {
        targetConversationId: arg.required({ description: "Conversation that remains" }),
        sourceConversationId: arg.required({ description: "Conversation merged into the target" }),
      },
      flags: {
        ...mailboxFlag,
        targetRevision: flag.int({ name: "target-revision", required: true, min: 1 }),
        sourceRevision: flag.int({ name: "source-revision", required: true, min: 1 }),
        reason: flag.string({ description: "Optional audit reason" }),
        yes: confirmFlag("Confirm conversation merge"),
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Pass --yes to merge the conversations.");
        if (!flags.targetRevision || !flags.sourceRevision) throw new Error("Both expected conversation revisions are required.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<MergeConversationsResult>(
          ctx,
          `/mailboxes/${mailbox.id}/conversations/${args.targetConversationId}/merge`,
          jsonRequest("POST", {
            sourceConversationId: args.sourceConversationId,
            expectedTargetRevision: flags.targetRevision,
            expectedSourceRevision: flags.sourceRevision,
            reason: flags.reason,
            confirm: true,
          }),
        );
        if (ctx.options.output === "json") ctx.json(value);
        else ctx.print(`Merged ${value.movedMessageCount} messages into ${value.target.id} at revision ${value.target.revision}.`);
      },
    }),
    command("conversation split", {
      summary: "Move selected messages into a separately pinned conversation",
      args: { conversationId: arg.required({ description: "Source conversation id" }) },
      flags: {
        ...mailboxFlag,
        message: flag.stringList({ description: "Message id to move; repeatable" }),
        revision: flag.int({ required: true, min: 1, description: "Expected source conversation revision" }),
        reason: flag.string({ description: "Optional audit reason" }),
        yes: confirmFlag("Confirm conversation split"),
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Pass --yes to split the conversation.");
        if (!flags.revision) throw new Error("Missing expected conversation revision.");
        if (flags.message.length === 0) throw new Error("Pass at least one --message id to move.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<SplitConversationResult>(
          ctx,
          `/mailboxes/${mailbox.id}/conversations/${args.conversationId}/split`,
          jsonRequest("POST", {
            messageIds: flags.message,
            expectedRevision: flags.revision,
            reason: flags.reason,
            confirm: true,
          }),
        );
        if (ctx.options.output === "json") ctx.json(value);
        else ctx.print(`Split ${value.movedMessageCount} messages into ${value.created.id}.`);
      },
    }),
    command("conversation collaboration", {
      summary: "Show assignment, queue state, snooze, and watchers",
      args: { conversationId: arg.required({ description: "Conversation id" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        printCollaboration(ctx, await readApi(ctx, collaborationPath(mailbox.id, args.conversationId)));
      },
    }),
    command("conversation update", {
      summary: "Update assignment, queue state, response-needed, or snooze",
      args: { conversationId: arg.required({ description: "Conversation id" }) },
      flags: {
        ...mailboxFlag,
        revision: flag.int({ required: true, min: 1, description: "Expected current conversation revision" }),
        assignee: flag.string({ description: "User id with current mailbox write access" }),
        unassign: flag.boolean({ description: "Clear the current assignee" }),
        status: flag.enum(["open", "waiting", "done"] as const),
        responseNeeded: flag.boolean({ name: "response-needed", description: "Mark a response as needed" }),
        noResponseNeeded: flag.boolean({ name: "no-response-needed", description: "Clear response-needed" }),
        snoozeUntil: flag.string({ name: "snooze-until", description: "Future ISO date-time" }),
        unsnooze: flag.boolean({ description: "Clear the snooze time" }),
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.revision) throw new Error("Missing expected conversation revision.");
        if (flags.assignee && flags.unassign) throw new Error("Use either --assignee or --unassign.");
        if (flags.responseNeeded && flags.noResponseNeeded) throw new Error("Use either --response-needed or --no-response-needed.");
        if (flags.snoozeUntil && flags.unsnooze) throw new Error("Use either --snooze-until or --unsnooze.");

        let snoozedUntil: string | null | undefined;
        if (flags.snoozeUntil) {
          const date = new Date(flags.snoozeUntil);
          if (!Number.isFinite(date.getTime())) throw new Error("--snooze-until must be a valid ISO date-time.");
          snoozedUntil = date.toISOString();
        } else if (flags.unsnooze) snoozedUntil = null;
        const input = {
          expectedRevision: flags.revision,
          ...(flags.assignee !== undefined || flags.unassign ? { assigneeUserId: flags.unassign ? null : flags.assignee } : {}),
          ...(flags.status ? { workStatus: flags.status } : {}),
          ...(flags.responseNeeded || flags.noResponseNeeded ? { responseNeeded: flags.responseNeeded } : {}),
          ...(snoozedUntil !== undefined ? { snoozedUntil } : {}),
        };
        if (Object.keys(input).length === 1) throw new Error("Pass at least one collaboration change.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<ConversationCollaboration>(
          ctx,
          collaborationPath(mailbox.id, args.conversationId),
          jsonRequest("PATCH", input),
        );
        printCollaboration(ctx, value);
      },
    }),
    command("conversation watch", {
      summary: "Add a mailbox user as conversation watcher",
      args: {
        conversationId: arg.required({ description: "Conversation id" }),
        userId: arg.required({ description: "Watcher user id" }),
      },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<ConversationCollaboration>(
          ctx,
          `/mailboxes/${mailbox.id}/conversations/${args.conversationId}/watchers/${args.userId}`,
          { method: "PUT" },
        );
        printCollaboration(ctx, value);
      },
    }),
    command("conversation unwatch", {
      summary: "Remove a conversation watcher",
      args: {
        conversationId: arg.required({ description: "Conversation id" }),
        userId: arg.required({ description: "Watcher user id" }),
      },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<ConversationCollaboration>(
          ctx,
          `/mailboxes/${mailbox.id}/conversations/${args.conversationId}/watchers/${args.userId}`,
          { method: "DELETE" },
        );
        printCollaboration(ctx, value);
      },
    }),
    command("conversation users", {
      summary: "List users eligible for assignment",
      flags: {
        ...mailboxFlag,
        search: flag.string({ description: "Search display name, uid, or granting group" }),
        limit: flag.int({ min: 1, max: 200, default: 50 }),
      },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = new URLSearchParams({ limit: String(flags.limit ?? 50) });
        if (flags.search) query.set("search", flags.search);
        const users = await readApi<MailAssignableUser[]>(ctx, `/mailboxes/${mailbox.id}/assignable-users?${query}`);
        printCollaborators(ctx, users);
      },
    }),
    command("conversation counts", {
      summary: "Show built-in collaboration view counts",
      flags: mailboxFlag,
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const counts = await readApi<Record<string, number>>(ctx, `/mailboxes/${mailbox.id}/conversation-view-counts`);
        if (ctx.options.output === "json") ctx.json(counts);
        else for (const [view, count] of Object.entries(counts)) ctx.print(`${view}: ${count}`);
      },
    }),
    command("conversation activity", {
      summary: "List durable mailbox or conversation activity",
      args: { conversationId: arg.optional({ description: "Optional conversation id" }) },
      flags: {
        ...mailboxFlag,
        cursor: flag.string({ description: "Opaque cursor returned by a previous page" }),
        limit: flag.int({ min: 1, max: 100, default: 50 }),
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = new URLSearchParams({ limit: String(flags.limit ?? 50) });
        if (args.conversationId) query.set("conversationId", args.conversationId);
        if (flags.cursor) query.set("cursor", flags.cursor);
        const page = await readApi<{ items: MailActivityEvent[]; nextCursor: string | null }>(
          ctx,
          `/mailboxes/${mailbox.id}/activity?${query}`,
        );
        printTable(
          ctx,
          page,
          page.items.map((event) => ({ date: event.createdAt, actor: event.actor.displayName, action: event.action, id: event.id })),
          [
            { key: "date", label: "DATE" },
            { key: "actor", label: "ACTOR" },
            { key: "action", label: "ACTION" },
            { key: "id", label: "EVENT ID" },
          ],
        );
      },
    }),
    command("reminder get", {
      summary: "Show your reminder for one conversation",
      args: { conversationId: arg.required({ description: "Conversation id" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<ConversationReminder | null>(
          ctx,
          `/mailboxes/${mailbox.id}/conversations/${args.conversationId}/reminder`,
        );
        if (ctx.options.output === "json") ctx.json(value);
        else if (value) ctx.print(`${value.dueAt} (${value.state}, revision ${value.revision}, ${value.id}).`);
        else ctx.print("No reminder.");
      },
    }),
    command("reminder set", {
      summary: "Create or reschedule your reminder for one conversation",
      args: { conversationId: arg.required({ description: "Conversation id" }) },
      flags: {
        ...mailboxFlag,
        due: flag.string({ required: true, description: "Reminder time as an ISO date-time" }),
        revision: flag.int({ min: 1, description: "Expected current revision; omit when creating" }),
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.due) throw new Error("Missing required flag --due.");
        const dueAt = parseOffsetDateTime(flags.due, "--due");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<ConversationReminder>(
          ctx,
          `/mailboxes/${mailbox.id}/conversations/${args.conversationId}/reminder`,
          jsonRequest("PUT", { dueAt, expectedRevision: flags.revision ?? null }),
        );
        if (ctx.options.output === "json") ctx.json(value);
        else ctx.print(`Reminder set for ${value.dueAt} at revision ${value.revision}.`);
      },
    }),
    command("reminder cancel", {
      summary: "Cancel your pending conversation reminder",
      args: { conversationId: arg.required({ description: "Conversation id" }) },
      flags: {
        ...mailboxFlag,
        revision: flag.int({ required: true, min: 1, description: "Expected current reminder revision" }),
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.revision) throw new Error("Missing expected reminder revision.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<ConversationReminder>(
          ctx,
          `/mailboxes/${mailbox.id}/conversations/${args.conversationId}/reminder`,
          jsonRequest("DELETE", { expectedRevision: flags.revision }),
        );
        if (ctx.options.output === "json") ctx.json(value);
        else ctx.print(`Canceled reminder ${value.id} at revision ${value.revision}.`);
      },
    }),
    command("saved-view list", {
      summary: "List private and mailbox-wide saved conversation views",
      flags: mailboxFlag,
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const views = await readApi<SavedConversationView[]>(ctx, `/mailboxes/${mailbox.id}/saved-views`);
        printTable(
          ctx,
          views,
          views.map((view) => ({ name: view.name, scope: view.scope, revision: view.revision, id: view.id })),
          [
            { key: "name", label: "NAME" },
            { key: "scope", label: "SCOPE" },
            { key: "revision", label: "REV" },
            { key: "id", label: "VIEW ID" },
          ],
        );
      },
    }),
    command("saved-view get", {
      summary: "Show one saved conversation view",
      args: { viewId: arg.required({ description: "Saved view id" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<SavedConversationView>(ctx, `/mailboxes/${mailbox.id}/saved-views/${args.viewId}`);
        if (ctx.options.output === "json") ctx.json(value);
        else {
          ctx.print(`${value.name} (${value.scope}, revision ${value.revision}, ${value.id})`);
          ctx.print(JSON.stringify(value.filter, null, 2));
        }
      },
    }),
    command("saved-view create", {
      summary: "Create a private or mailbox-wide saved conversation view",
      args: { name: arg.required({ description: "Saved view name" }) },
      flags: {
        ...mailboxFlag,
        scope: flag.enum(["private", "mailbox"] as const, { default: "private" }),
        filter: savedViewFilterInput,
      },
      run: async ({ ctx, args, flags }) => {
        const filter = await readSavedViewFilter(flags.filter, true);
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<SavedConversationView>(
          ctx,
          `/mailboxes/${mailbox.id}/saved-views`,
          jsonRequest("POST", { name: args.name, scope: flags.scope ?? "private", filter }),
        );
        if (ctx.options.output === "json") ctx.json(value);
        else ctx.print(`Created ${value.scope} saved view ${value.name} (${value.id}).`);
      },
    }),
    command("saved-view update", {
      summary: "Rename or change one saved conversation view",
      args: { viewId: arg.required({ description: "Saved view id" }) },
      flags: {
        ...mailboxFlag,
        revision: flag.int({ required: true, min: 1, description: "Expected current saved view revision" }),
        name: flag.string({ description: "New saved view name" }),
        filter: savedViewFilterInput,
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.revision) throw new Error("Missing expected saved view revision.");
        const filter = await readSavedViewFilter(flags.filter, false);
        if (flags.name === undefined && filter === undefined) throw new Error("Pass --name or a saved view filter.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<SavedConversationView>(
          ctx,
          `/mailboxes/${mailbox.id}/saved-views/${args.viewId}`,
          jsonRequest("PATCH", {
            expectedRevision: flags.revision,
            ...(flags.name !== undefined ? { name: flags.name } : {}),
            ...(filter ? { filter } : {}),
          }),
        );
        if (ctx.options.output === "json") ctx.json(value);
        else ctx.print(`Updated saved view ${value.name} to revision ${value.revision}.`);
      },
    }),
    command("saved-view delete", {
      summary: "Delete one saved conversation view",
      args: { viewId: arg.required({ description: "Saved view id" }) },
      flags: {
        ...mailboxFlag,
        revision: flag.int({ required: true, min: 1, description: "Expected current saved view revision" }),
        yes: confirmFlag("Confirm saved view deletion"),
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Pass --yes to delete the saved view.");
        if (!flags.revision) throw new Error("Missing expected saved view revision.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<{ id: string }>(
          ctx,
          `/mailboxes/${mailbox.id}/saved-views/${args.viewId}`,
          jsonRequest("DELETE", { expectedRevision: flags.revision }),
        );
        if (ctx.options.output === "json") ctx.json(value);
        else ctx.print(`Deleted saved view ${value.id}.`);
      },
    }),
    command("saved-view conversations", {
      summary: "List conversations selected by one saved view",
      args: { viewId: arg.required({ description: "Saved view id" }) },
      flags: {
        ...mailboxFlag,
        cursor: flag.string({ description: "Opaque cursor returned by a previous page" }),
        limit: flag.int({ min: 1, max: 100, default: 50 }),
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = new URLSearchParams({ limit: String(flags.limit ?? 50) });
        if (flags.cursor) query.set("cursor", flags.cursor);
        const page = await readApi<{ items: ConversationSummary[]; nextCursor: string | null }>(
          ctx,
          `/mailboxes/${mailbox.id}/saved-views/${args.viewId}/conversations?${query}`,
        );
        printTable(
          ctx,
          page,
          page.items.map((thread) => ({
            date: thread.latestMessageAt,
            unread: thread.unread ? "yes" : "",
            status: thread.workStatus,
            participants: thread.participantSummary,
            subject: thread.subject,
            id: thread.id,
          })),
          [
            { key: "date", label: "DATE" },
            { key: "unread", label: "UNREAD" },
            { key: "status", label: "STATUS" },
            { key: "participants", label: "PARTICIPANTS" },
            { key: "subject", label: "SUBJECT" },
            { key: "id", label: "THREAD ID" },
          ],
        );
      },
    }),
    command("comment list", {
      summary: "List internal comments in chronological order",
      args: { conversationId: arg.required({ description: "Conversation id" }) },
      flags: {
        ...mailboxFlag,
        cursor: flag.string({ description: "Opaque cursor returned by a previous page" }),
        limit: flag.int({ min: 1, max: 100, default: 50 }),
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = new URLSearchParams({ limit: String(flags.limit ?? 50) });
        if (flags.cursor) query.set("cursor", flags.cursor);
        const page = await readApi<{ items: ConversationComment[]; nextCursor: string | null }>(
          ctx,
          `/mailboxes/${mailbox.id}/conversations/${args.conversationId}/comments?${query}`,
        );
        printTable(
          ctx,
          page,
          page.items.map((comment) => ({
            date: comment.createdAt,
            author: comment.author.displayName,
            revision: comment.revision,
            body: comment.body?.replace(/\s+/g, " ").slice(0, 120) ?? "[deleted]",
            id: comment.id,
          })),
          [
            { key: "date", label: "DATE" },
            { key: "author", label: "AUTHOR" },
            { key: "revision", label: "REV" },
            { key: "body", label: "COMMENT" },
            { key: "id", label: "COMMENT ID" },
          ],
        );
      },
    }),
    command("comment users", {
      summary: "List mailbox users eligible for mentions",
      flags: {
        ...mailboxFlag,
        search: flag.string({ description: "Search display name, uid, or granting group" }),
        limit: flag.int({ min: 1, max: 200, default: 50 }),
      },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = new URLSearchParams({ limit: String(flags.limit ?? 50) });
        if (flags.search) query.set("search", flags.search);
        printCollaborators(ctx, await readApi(ctx, `/mailboxes/${mailbox.id}/mentionable-users?${query}`));
      },
    }),
    command("comment add", {
      summary: "Add an internal Markdown comment",
      args: { conversationId: arg.required({ description: "Conversation id" }) },
      flags: {
        ...mailboxFlag,
        body: flag.input({ required: true, fileName: "body-file", stdinName: "body-stdin", description: "Comment body" }),
        mention: flag.stringList({ description: "Mentioned user id; repeatable" }),
        parent: flag.string({ description: "Parent comment id" }),
        message: flag.string({ description: "Referenced message id" }),
      },
      run: async ({ ctx, args, flags }) => {
        const body = await readCliInput(flags.body, { label: "comment body", required: true });
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<ConversationComment>(
          ctx,
          `/mailboxes/${mailbox.id}/conversations/${args.conversationId}/comments`,
          jsonRequest("POST", {
            body: body ?? "",
            mentionUserIds: flags.mention,
            parentCommentId: flags.parent,
            referencedMessageId: flags.message,
          }),
        );
        if (ctx.options.output === "json") ctx.json(value);
        else ctx.print(`Created comment ${value.id} at revision ${value.revision}.`);
      },
    }),
    command("comment edit", {
      summary: "Edit an internal comment with optimistic concurrency",
      args: {
        conversationId: arg.required({ description: "Conversation id" }),
        commentId: arg.required({ description: "Comment id" }),
      },
      flags: {
        ...mailboxFlag,
        revision: flag.int({ required: true, min: 1, description: "Expected current comment revision" }),
        body: flag.input({ required: true, fileName: "body-file", stdinName: "body-stdin", description: "Updated comment body" }),
        mention: flag.stringList({ description: "Mentioned user id; repeatable" }),
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.revision) throw new Error("Missing expected comment revision.");
        const body = await readCliInput(flags.body, { label: "comment body", required: true });
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<ConversationComment>(
          ctx,
          `/mailboxes/${mailbox.id}/conversations/${args.conversationId}/comments/${args.commentId}`,
          jsonRequest("PATCH", { expectedRevision: flags.revision, body: body ?? "", mentionUserIds: flags.mention }),
        );
        if (ctx.options.output === "json") ctx.json(value);
        else ctx.print(`Updated comment ${value.id} to revision ${value.revision}.`);
      },
    }),
    command("comment delete", {
      summary: "Replace an internal comment with a deletion tombstone",
      args: {
        conversationId: arg.required({ description: "Conversation id" }),
        commentId: arg.required({ description: "Comment id" }),
      },
      flags: {
        ...mailboxFlag,
        revision: flag.int({ required: true, min: 1, description: "Expected current comment revision" }),
        yes: confirmFlag("Confirm internal comment deletion"),
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Pass --yes to delete the internal comment.");
        if (!flags.revision) throw new Error("Missing expected comment revision.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const value = await readApi<ConversationComment>(
          ctx,
          `/mailboxes/${mailbox.id}/conversations/${args.conversationId}/comments/${args.commentId}`,
          jsonRequest("DELETE", { expectedRevision: flags.revision }),
        );
        if (ctx.options.output === "json") ctx.json(value);
        else ctx.print(`Deleted comment ${value.id} at revision ${value.revision}.`);
      },
    }),
    conversationActionCommand("conversation read", "Mark every message in a conversation folder placement as read", {
      kind: "change_state",
      change: { addFlags: ["seen"] },
    }),
    conversationActionCommand("conversation unread", "Mark every message in a conversation folder placement as unread", {
      kind: "change_state",
      change: { removeFlags: ["seen"] },
    }),
    conversationActionCommand("conversation star", "Star every message in a conversation folder placement", {
      kind: "change_state",
      change: { addFlags: ["flagged"] },
    }),
    conversationActionCommand("conversation unstar", "Remove stars from every message in a conversation folder placement", {
      kind: "change_state",
      change: { removeFlags: ["flagged"] },
    }),
    conversationActionCommand("conversation archive", "Move a conversation from one folder to the configured Archive folder", {
      kind: "move_to_role",
      role: "archive",
    }),
    conversationActionCommand("conversation trash", "Move a conversation from one folder to the configured Trash folder", {
      kind: "move_to_role",
      role: "trash",
    }),
    conversationActionCommand("conversation junk", "Move a conversation from one folder to the configured Junk folder", {
      kind: "move_to_role",
      role: "junk",
    }),
    command("provider add", {
      summary: "Verify and store a write-only IMAP/SMTP provider credential",
      flags: {
        ...mailboxFlag,
        ownerUserId: flag.string({
          name: "owner-user-id",
          description: "Create a private user-owned connection instead of a mailbox-owned connection",
        }),
        ...providerConnectionFlags,
      },
      run: async ({ ctx, flags }) => {
        const mailbox = flags.ownerUserId ? null : await resolveMailbox(ctx, flags.mailbox);
        const connection = await providerConnectionInput(flags);
        const result = await readApi<ProviderConnectionResult>(
          ctx,
          "/connections",
          jsonRequest("POST", {
            owner: flags.ownerUserId ? { type: "user", userId: flags.ownerUserId } : { type: "mailbox", mailboxId: mailbox!.id },
            connection,
          }),
        );
        if (ctx.options.output === "json") ctx.json(result);
        else
          ctx.print(`Stored verified connection ${result.connection.name} (${result.connection.id}); the credential cannot be read back.`);
      },
    }),
    command("provider replace", {
      summary: "Replace a provider credential and require binding re-verification",
      args: { connectionId: arg.required({ description: "Provider connection id" }) },
      flags: providerConnectionFlags,
      run: async ({ ctx, args, flags }) => {
        const result = await readApi<ProviderConnectionResult>(
          ctx,
          `/connections/${args.connectionId}`,
          jsonRequest("PUT", await providerConnectionInput(flags)),
        );
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Replaced ${result.connection.name}; attached remote resources now require re-verification.`);
      },
    }),
    command("provider revoke", {
      summary: "Destroy a provider credential and revoke its bindings",
      args: { connectionId: arg.required({ description: "Provider connection id" }) },
      flags: { yes: confirmFlag("Confirm provider credential revocation") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Pass --yes to revoke the provider credential.");
        await readApi(ctx, `/connections/${args.connectionId}`, { method: "DELETE" });
        if (ctx.options.output === "json") ctx.json({ revoked: true, connectionId: args.connectionId });
        else ctx.print(`Revoked provider connection ${args.connectionId}.`);
      },
    }),
    command("provider list", {
      summary: "List provider connections visible to the current actor",
      flags: mailboxFlag,
      run: async ({ ctx, flags }) => {
        const mailbox = flags.mailbox ? await resolveMailbox(ctx, flags.mailbox) : null;
        const query = mailbox ? `?mailboxId=${encodeURIComponent(mailbox.id)}` : "";
        const connections = await readApi<ProviderConnection[]>(ctx, `/connections${query}`);
        printTable(
          ctx,
          connections,
          connections.map((connection) => ({
            name: connection.name,
            email: connection.email,
            owner: connection.owner.type,
            status: connection.status,
            id: connection.id,
          })),
          [
            { key: "name", label: "NAME" },
            { key: "email", label: "EMAIL" },
            { key: "owner", label: "OWNER" },
            { key: "status", label: "STATUS" },
            { key: "id", label: "ID" },
          ],
        );
      },
    }),
    command("binding list", {
      summary: "List provider bindings for a mailbox",
      flags: mailboxFlag,
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const bindings = await readApi<ProviderBinding[]>(ctx, `/mailboxes/${mailbox.id}/bindings`);
        printTable(
          ctx,
          bindings,
          bindings.map((binding) => ({
            state: binding.state,
            principal: binding.authenticatedPrincipal ?? "",
            root: binding.rootPath,
            connection: binding.connectionId,
            id: binding.id,
          })),
          [
            { key: "state", label: "STATE" },
            { key: "principal", label: "PRINCIPAL" },
            { key: "root", label: "ROOT" },
            { key: "connection", label: "CONNECTION ID" },
            { key: "id", label: "BINDING ID" },
          ],
        );
      },
    }),
    command("binding attach", {
      summary: "Attach and discover a provider connection",
      args: { connectionId: arg.required({ description: "Provider connection id" }) },
      flags: { ...mailboxFlag, root: flag.string({ description: "Optional IMAP folder root" }) },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const result = await readApi<ProviderBindingResult>(
          ctx,
          `/mailboxes/${mailbox.id}/bindings`,
          jsonRequest("POST", { connectionId: args.connectionId, rootPath: flags.root }),
        );
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`${result.binding.state}: ${result.comparisonReason} (${result.binding.id})`);
      },
    }),
    command("binding confirm", {
      summary: "Explicitly confirm an ambiguous provider binding",
      args: { bindingId: arg.required({ description: "Pending binding id" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const binding = await readApi<ProviderBinding>(ctx, `/mailboxes/${mailbox.id}/bindings/${args.bindingId}/confirm`, {
          method: "POST",
        });
        if (ctx.options.output === "json") ctx.json(binding);
        else ctx.print(`Confirmed binding ${binding.id}.`);
      },
    }),
    command("identity list", {
      summary: "List sender identities for a mailbox",
      flags: mailboxFlag,
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const identities = await readApi<SenderIdentity[]>(ctx, `/mailboxes/${mailbox.id}/sender-identities`);
        printTable(
          ctx,
          identities,
          identities.map((identity) => ({
            address: identity.fromAddress,
            name: identity.displayName,
            status: identity.status,
            mode: identity.authenticationPolicy.interactive,
            default: identity.isDefault ? "yes" : "",
            id: identity.id,
          })),
          [
            { key: "address", label: "ADDRESS" },
            { key: "name", label: "NAME" },
            { key: "status", label: "STATUS" },
            { key: "mode", label: "MODE" },
            { key: "default", label: "DEFAULT" },
            { key: "id", label: "IDENTITY ID" },
          ],
        );
      },
    }),
    command("identity add", {
      summary: "Create a sender identity",
      flags: {
        ...mailboxFlag,
        address: flag.string({ required: true }),
        name: flag.string({ description: "Display name" }),
        mode: flag.enum(["mailbox", "actor"] as const, { default: "mailbox" }),
        sentFolder: flag.string({ name: "sent-folder", description: "Canonical Sent folder id" }),
        default: flag.boolean({ description: "Set as default identity" }),
      },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const identity = await readApi<SenderIdentity>(
          ctx,
          `/mailboxes/${mailbox.id}/sender-identities`,
          jsonRequest("POST", {
            displayName: flags.name ?? "",
            fromAddress: flags.address,
            authenticationPolicy: { interactive: flags.mode, automation: "disabled" },
            sentFolderId: flags.sentFolder,
            isDefault: flags.default,
          }),
        );
        if (ctx.options.output === "json") ctx.json(identity);
        else ctx.print(`Created unverified identity ${identity.fromAddress} (${identity.id}).`);
      },
    }),
    command("identity setup-default", {
      summary: "Create or update and verify the provider account's default sender",
      args: { bindingId: arg.required({ description: "Active provider binding id" }) },
      flags: {
        ...mailboxFlag,
        name: flag.string({ description: "User-visible sender display name" }),
        providerSavesSent: flag.boolean({
          name: "provider-saves-sent",
          description: "Provider automatically stores submitted messages in Sent",
        }),
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const identity = await readApi<SenderIdentity>(
          ctx,
          `/mailboxes/${mailbox.id}/sender-identities/default/setup`,
          jsonRequest("POST", {
            bindingId: args.bindingId,
            ...(flags.name !== undefined ? { displayName: flags.name } : {}),
            savesSentAutomatically: flags.providerSavesSent,
          }),
        );
        if (ctx.options.output === "json") ctx.json(identity);
        else ctx.print(`Default sender ${identity.fromAddress} is ${identity.status}.`);
      },
    }),
    command("identity configure", {
      summary: "Update sender metadata, policy, or provider folder mappings",
      args: { identityId: arg.required({ description: "Sender identity id" }) },
      flags: {
        ...mailboxFlag,
        address: flag.string({ description: "From address" }),
        name: flag.string({ description: "Display name" }),
        replyTo: flag.string({ name: "reply-to" }),
        clearReplyTo: flag.boolean({ name: "clear-reply-to" }),
        envelopeSender: flag.string({ name: "envelope-sender" }),
        clearEnvelopeSender: flag.boolean({ name: "clear-envelope-sender" }),
        mode: flag.enum(["mailbox", "actor"] as const, { description: "Interactive credential mode" }),
        automation: flag.enum(["disabled", "mailbox", "pool"] as const, { description: "Automation credential mode" }),
        sentFolder: flag.string({ name: "sent-folder" }),
        clearSentFolder: flag.boolean({ name: "clear-sent-folder" }),
        draftsFolder: flag.string({ name: "drafts-folder" }),
        clearDraftsFolder: flag.boolean({ name: "clear-drafts-folder" }),
        default: flag.boolean({ description: "Make this the default identity" }),
      },
      run: async ({ ctx, args, flags }) => {
        if (flags.replyTo && flags.clearReplyTo) throw new Error("Use either --reply-to or --clear-reply-to.");
        if (flags.envelopeSender && flags.clearEnvelopeSender) {
          throw new Error("Use either --envelope-sender or --clear-envelope-sender.");
        }
        if (flags.sentFolder && flags.clearSentFolder) throw new Error("Use either --sent-folder or --clear-sent-folder.");
        if (flags.draftsFolder && flags.clearDraftsFolder) throw new Error("Use either --drafts-folder or --clear-drafts-folder.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const identities = await readApi<SenderIdentity[]>(ctx, `/mailboxes/${mailbox.id}/sender-identities`);
        const current = identities.find((identity) => identity.id === args.identityId);
        if (!current) throw new Error(`Sender identity ${args.identityId} was not found.`);
        const update = {
          ...(flags.address !== undefined ? { fromAddress: flags.address } : {}),
          ...(flags.name !== undefined ? { displayName: flags.name } : {}),
          ...(flags.replyTo !== undefined || flags.clearReplyTo ? { replyTo: flags.clearReplyTo ? null : flags.replyTo } : {}),
          ...(flags.envelopeSender !== undefined || flags.clearEnvelopeSender
            ? { envelopeSender: flags.clearEnvelopeSender ? null : flags.envelopeSender }
            : {}),
          ...(flags.mode !== undefined || flags.automation !== undefined
            ? {
                authenticationPolicy: {
                  interactive: flags.mode ?? current.authenticationPolicy.interactive,
                  automation: flags.automation ?? current.authenticationPolicy.automation,
                },
              }
            : {}),
          ...(flags.sentFolder !== undefined || flags.clearSentFolder
            ? { sentFolderId: flags.clearSentFolder ? null : flags.sentFolder }
            : {}),
          ...(flags.draftsFolder !== undefined || flags.clearDraftsFolder
            ? { draftsFolderId: flags.clearDraftsFolder ? null : flags.draftsFolder }
            : {}),
          ...(flags.default ? { isDefault: true } : {}),
        };
        if (Object.keys(update).length === 0) throw new Error("Pass at least one sender identity setting.");
        const identity = await readApi<SenderIdentity>(
          ctx,
          `/mailboxes/${mailbox.id}/sender-identities/${args.identityId}`,
          jsonRequest("PATCH", update),
        );
        if (ctx.options.output === "json") ctx.json(identity);
        else ctx.print(`Updated ${identity.fromAddress} (${identity.status}).`);
      },
    }),
    command("identity disable", {
      summary: "Disable a sender identity and revoke its provider verification",
      args: { identityId: arg.required({ description: "Sender identity id" }) },
      flags: { ...mailboxFlag, yes: confirmFlag("Confirm sender identity disable") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Pass --yes to disable the sender identity.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        await readApi(ctx, `/mailboxes/${mailbox.id}/sender-identities/${args.identityId}`, { method: "DELETE" });
        if (ctx.options.output === "json") ctx.json({ disabled: true, identityId: args.identityId });
        else ctx.print(`Disabled sender identity ${args.identityId}.`);
      },
    }),
    command("identity verify", {
      summary: "Verify sender submission through one binding",
      args: { identityId: arg.required(), bindingId: arg.required() },
      flags: {
        ...mailboxFlag,
        recipient: flag.string({ required: true, description: "Address receiving the verification message" }),
        providerSavesSent: flag.boolean({
          name: "provider-saves-sent",
          description: "Provider automatically stores submitted mail in Sent",
        }),
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const identity = await readApi<SenderIdentity>(
          ctx,
          `/mailboxes/${mailbox.id}/sender-identities/${args.identityId}/verify`,
          jsonRequest("POST", {
            bindingId: args.bindingId,
            verificationRecipient: flags.recipient,
            savesSentAutomatically: flags.providerSavesSent,
          }),
        );
        if (ctx.options.output === "json") ctx.json(identity);
        else ctx.print(`Verified ${identity.fromAddress}.`);
      },
    }),
    command("draft list", {
      summary: "List recent shared drafts",
      flags: { ...mailboxFlag, limit: flag.int({ min: 1, max: 200, default: 100 }) },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const drafts = await readApi<MailDraft[]>(ctx, `/mailboxes/${mailbox.id}/drafts?limit=${flags.limit ?? 100}`);
        printTable(
          ctx,
          drafts,
          drafts.map((draft) => ({
            updated: draft.updatedAt,
            state: draft.state,
            revision: draft.revision,
            subject: draft.subject,
            id: draft.id,
          })),
          [
            { key: "updated", label: "UPDATED" },
            { key: "state", label: "STATE" },
            { key: "revision", label: "REV" },
            { key: "subject", label: "SUBJECT" },
            { key: "id", label: "DRAFT ID" },
          ],
        );
      },
    }),
    command("draft get", {
      summary: "Show one shared draft including attachment metadata",
      args: { draftId: arg.required({ description: "Draft id" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const draft = await readApi<MailDraft>(ctx, `/mailboxes/${mailbox.id}/drafts/${args.draftId}`);
        if (ctx.options.output === "json") ctx.json(draft);
        else {
          ctx.print(`${draft.subject || "[No subject]"} (${draft.id})`);
          ctx.print(`State: ${draft.state}; revision ${draft.revision}; ${draft.attachments.length} attachment(s)`);
          ctx.print("");
          ctx.print(draft.body);
        }
      },
    }),
    command("draft lease get", {
      summary: "Show the advisory editor lease for a shared draft",
      args: { draftId: arg.required({ description: "Draft id" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const lease = await readApi<DraftLease | null>(ctx, `/mailboxes/${mailbox.id}/drafts/${args.draftId}/lease`);
        if (printStructured(ctx, lease)) return;
        if (!lease) ctx.print("No active draft lease.");
        else ctx.print(`${lease.holder.displayName} holds the lease until ${lease.expiresAt}.`);
      },
    }),
    command("draft lease acquire", {
      summary: "Acquire or explicitly take over a shared draft editor lease",
      args: { draftId: arg.required({ description: "Draft id" }) },
      flags: { ...mailboxFlag, takeover: flag.boolean({ description: "Replace the current advisory lease" }) },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const lease = await readApi<AcquiredDraftLease>(
          ctx,
          `/mailboxes/${mailbox.id}/drafts/${args.draftId}/lease`,
          jsonRequest("POST", { takeover: flags.takeover }),
        );
        if (printStructured(ctx, lease)) return;
        ctx.print(`Acquired draft lease until ${lease.expiresAt}.`);
        ctx.print(`Token: ${lease.token}`);
      },
    }),
    command("draft lease heartbeat", {
      summary: "Extend an owned shared draft editor lease",
      args: { draftId: arg.required({ description: "Draft id" }) },
      flags: { ...mailboxFlag, token: flag.string({ required: true, description: "Lease token" }) },
      run: async ({ ctx, args, flags }) => {
        if (!flags.token) throw new Error("Missing draft lease token.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const lease = await readApi<AcquiredDraftLease>(
          ctx,
          `/mailboxes/${mailbox.id}/drafts/${args.draftId}/lease`,
          jsonRequest("PUT", { token: flags.token }),
        );
        if (printStructured(ctx, lease)) return;
        ctx.print(`Extended draft lease until ${lease.expiresAt}.`);
      },
    }),
    command("draft lease release", {
      summary: "Release an owned shared draft editor lease",
      args: { draftId: arg.required({ description: "Draft id" }) },
      flags: { ...mailboxFlag, token: flag.string({ required: true, description: "Lease token" }) },
      run: async ({ ctx, args, flags }) => {
        if (!flags.token) throw new Error("Missing draft lease token.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        await readApi<void>(ctx, `/mailboxes/${mailbox.id}/drafts/${args.draftId}/lease`, jsonRequest("DELETE", { token: flags.token }));
        if (printStructured(ctx, { released: true, draftId: args.draftId })) return;
        ctx.print("Released draft lease.");
      },
    }),
    command("draft create", {
      summary: "Create a shared draft",
      flags: { ...mailboxFlag, ...draftContentFlags },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const draft = await createDraft(ctx, mailbox.id, flags);
        if (ctx.options.output === "json") ctx.json(draft);
        else ctx.print(`Created draft ${draft.id} (revision ${draft.revision}).`);
      },
    }),
    command("draft update", {
      summary: "Replace a shared draft at an expected revision",
      args: { draftId: arg.required({ description: "Draft id" }) },
      flags: {
        ...mailboxFlag,
        ...draftEditableContentFlags,
        revision: flag.int({ required: true, min: 1, description: "Expected current revision" }),
      },
      run: async ({ ctx, args, flags }) => {
        if (flags.revision === undefined) throw new Error("Missing expected draft revision.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const draft = await readApi<MailDraft>(
          ctx,
          `/mailboxes/${mailbox.id}/drafts/${args.draftId}`,
          jsonRequest("PUT", { expectedRevision: flags.revision, draft: await readDraftEditableContent(flags) }),
        );
        if (ctx.options.output === "json") ctx.json(draft);
        else ctx.print(`Updated draft ${draft.id} to revision ${draft.revision}.`);
      },
    }),
    command("draft recovery list", {
      summary: "List conflict recovery copies for a shared draft",
      args: { draftId: arg.required({ description: "Draft id" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const copies = await readApi<DraftRecoveryCopy[]>(ctx, `/mailboxes/${mailbox.id}/drafts/${args.draftId}/recovery-copies`);
        printTable(
          ctx,
          copies,
          copies.map((copy) => ({
            created: copy.createdAt,
            baseRevision: copy.baseRevision,
            restored: copy.restoredAt ?? "",
            subject: copy.content.subject,
            id: copy.id,
          })),
          [
            { key: "created", label: "CREATED" },
            { key: "baseRevision", label: "BASE REV" },
            { key: "restored", label: "RESTORED" },
            { key: "subject", label: "SUBJECT" },
            { key: "id", label: "RECOVERY ID" },
          ],
        );
      },
    }),
    command("draft recovery restore", {
      summary: "Restore a recovery copy at an expected draft revision",
      args: {
        draftId: arg.required({ description: "Draft id" }),
        recoveryId: arg.required({ description: "Recovery copy id" }),
      },
      flags: {
        ...mailboxFlag,
        revision: flag.int({ required: true, min: 1, description: "Expected current draft revision" }),
      },
      run: async ({ ctx, args, flags }) => {
        if (flags.revision === undefined) throw new Error("Missing expected draft revision.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const draft = await readApi<MailDraft>(
          ctx,
          `/mailboxes/${mailbox.id}/drafts/${args.draftId}/recovery-copies/${args.recoveryId}/restore`,
          jsonRequest("POST", { expectedRevision: flags.revision }),
        );
        if (ctx.options.output === "json") ctx.json(draft);
        else ctx.print(`Restored recovery copy into draft ${draft.id}; revision ${draft.revision}.`);
      },
    }),
    command("draft attachment add", {
      summary: "Stream a local file into a shared draft",
      args: {
        draftId: arg.required({ description: "Draft id" }),
        path: arg.required({ description: "Local attachment path" }),
      },
      flags: {
        ...mailboxFlag,
        revision: flag.int({ required: true, min: 1, description: "Expected current draft revision" }),
        name: flag.string({ description: "Attachment filename; defaults to the local basename" }),
        contentType: flag.string({ name: "content-type", description: "MIME content type" }),
        upload: flag.string({ description: "Resume an existing attachment upload id" }),
      },
      run: async ({ ctx, args, flags }) => {
        if (flags.revision === undefined) throw new Error("Missing expected draft revision.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const draft = await uploadDraftAttachment({
          ctx,
          mailboxId: mailbox.id,
          draftId: args.draftId,
          expectedRevision: flags.revision,
          path: args.path,
          filename: flags.name,
          contentType: flags.contentType,
          uploadId: flags.upload,
        });
        if (ctx.options.output === "json") ctx.json(draft);
        else ctx.print(`Added attachment to draft ${draft.id}; revision ${draft.revision}.`);
      },
    }),
    command("draft attachment upload list", {
      summary: "List resumable attachment uploads for a shared draft",
      args: { draftId: arg.required({ description: "Draft id" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const uploads = await readApi<DraftAttachmentUpload[]>(ctx, `/mailboxes/${mailbox.id}/drafts/${args.draftId}/attachment-uploads`);
        printTable(
          ctx,
          uploads,
          uploads.map((upload) => ({
            state: upload.state,
            received: upload.receivedBytes,
            total: upload.byteLength,
            filename: upload.filename,
            id: upload.id,
          })),
          [
            { key: "state", label: "STATE" },
            { key: "received", label: "RECEIVED" },
            { key: "total", label: "TOTAL" },
            { key: "filename", label: "FILENAME" },
            { key: "id", label: "UPLOAD ID" },
          ],
        );
      },
    }),
    command("draft attachment upload cancel", {
      summary: "Cancel a resumable attachment upload",
      args: {
        draftId: arg.required({ description: "Draft id" }),
        uploadId: arg.required({ description: "Attachment upload id" }),
      },
      flags: { ...mailboxFlag, yes: confirmFlag("Confirm attachment upload cancellation") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Pass --yes to cancel the attachment upload.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const upload = await readApi<DraftAttachmentUpload>(
          ctx,
          `/mailboxes/${mailbox.id}/drafts/${args.draftId}/attachment-uploads/${args.uploadId}`,
          { method: "DELETE" },
        );
        if (printStructured(ctx, upload)) return;
        ctx.print(`Cancelled attachment upload ${upload.id}.`);
      },
    }),
    command("draft attachment remove", {
      summary: "Remove an attachment from a shared draft",
      args: {
        draftId: arg.required({ description: "Draft id" }),
        attachmentId: arg.required({ description: "Draft attachment id" }),
      },
      flags: {
        ...mailboxFlag,
        revision: flag.int({ required: true, min: 1, description: "Expected current draft revision" }),
      },
      run: async ({ ctx, args, flags }) => {
        if (flags.revision === undefined) throw new Error("Missing expected draft revision.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = new URLSearchParams({ expectedRevision: String(flags.revision) });
        const draft = await readApi<MailDraft>(
          ctx,
          `/mailboxes/${mailbox.id}/drafts/${args.draftId}/attachments/${args.attachmentId}?${query}`,
          { method: "DELETE" },
        );
        if (ctx.options.output === "json") ctx.json(draft);
        else ctx.print(`Removed attachment from draft ${draft.id}; revision ${draft.revision}.`);
      },
    }),
    command("draft attachment download", {
      summary: "Download an attachment from a shared draft",
      args: {
        draftId: arg.required({ description: "Draft id" }),
        attachmentId: arg.required({ description: "Draft attachment id" }),
      },
      flags: {
        ...mailboxFlag,
        out: flag.string({ required: true, aliases: ["output"], description: "Output file path" }),
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.out) throw new Error("Missing required flag --out.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const response = await ctx.fetch(apiPath(`/mailboxes/${mailbox.id}/drafts/${args.draftId}/attachments/${args.attachmentId}`));
        if (!response.ok) {
          await ctx.readJson(response);
          throw new Error(`Draft attachment download failed with HTTP ${response.status}.`);
        }
        const bytes = await streamResponseToFile(response, flags.out);
        const result = { path: flags.out, bytes, contentType: response.headers.get("content-type"), etag: response.headers.get("etag") };
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Wrote ${bytes} bytes to ${flags.out}.`);
      },
    }),
    command("draft discard", {
      summary: "Discard a shared draft at an expected revision",
      args: { draftId: arg.required({ description: "Draft id" }) },
      flags: {
        ...mailboxFlag,
        revision: flag.int({ required: true, min: 1, description: "Expected current draft revision" }),
        yes: confirmFlag("Confirm draft discard"),
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Pass --yes to discard the draft.");
        if (flags.revision === undefined) throw new Error("Missing expected draft revision.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const draft = await readApi<MailDraft>(
          ctx,
          `/mailboxes/${mailbox.id}/drafts/${args.draftId}/discard`,
          jsonRequest("POST", { expectedRevision: flags.revision }),
        );
        if (ctx.options.output === "json") ctx.json(draft);
        else ctx.print(`Discarded draft ${draft.id} at revision ${draft.revision}.`);
      },
    }),
    command("send", {
      summary: "Create an immutable draft snapshot and queue delivery",
      flags: {
        ...mailboxFlag,
        ...draftContentFlags,
        schedule: flag.string({ description: "Optional ISO send time" }),
        undo: flag.int({ min: 0, max: 60, default: 10, description: "Undo window in seconds" }),
        attachment: flag.stringList({ name: "attach", description: "Local attachment path; repeatable" }),
        idempotencyKey: flag.string({ name: "idempotency-key", description: "Stable client retry key" }),
        wait: flag.boolean({ description: "Wait for a successful terminal command state" }),
        ...waitFlags,
      },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        let draft = await createDraft(ctx, mailbox.id, flags);
        for (const path of flags.attachment) {
          draft = await uploadDraftAttachment({
            ctx,
            mailboxId: mailbox.id,
            draftId: draft.id,
            expectedRevision: draft.revision,
            path,
          });
        }
        const command = await readApi<MailCommand>(
          ctx,
          `/mailboxes/${mailbox.id}/commands`,
          jsonRequest("POST", {
            kind: "send",
            draftId: draft.id,
            expectedDraftRevision: draft.revision,
            senderIdentityId: flags.identity,
            scheduledAt: flags.schedule ? new Date(flags.schedule).toISOString() : undefined,
            undoSeconds: flags.undo,
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
          }),
        );
        const result = flags.wait ? await waitForCommand(ctx, mailbox.id, command.id, flags.timeoutSeconds) : command;
        if (ctx.options.output === "json") ctx.json({ draft, command: result });
        else ctx.print(`${flags.wait ? "Sent" : "Queued"} message ${result.id} (${result.state}).`);
      },
    }),
    command("workflow validate", {
      summary: "Validate exact canonical workflow YAML source",
      flags: { ...mailboxFlag, source: workflowSourceInput },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const validation = await readApi<WorkflowValidation>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows/validate`,
          jsonRequest("POST", { source: await readWorkflowSource(flags.source) }),
        );
        if (printStructured(ctx, validation)) return;
        else {
          ctx.print(validation.valid ? "Workflow is valid." : "Workflow is invalid.");
          for (const diagnostic of validation.diagnostics) {
            ctx.print(`${diagnostic.severity}: ${diagnostic.path}: ${diagnostic.message}`);
          }
        }
      },
    }),
    command("workflow preflight", {
      summary: "Create a version-pinned execution preflight without changing mail",
      args: { workflowId: arg.required({ description: "Workflow id" }) },
      flags: {
        ...mailboxFlag,
        versionId: flag.string({ name: "version-id", required: true, description: "Immutable workflow version id to preflight" }),
        query: workflowQueryInput,
        inputs: workflowInputsInput,
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const preflight = await readApi<MailWorkflowPreflight>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows/${args.workflowId}/preflight`,
          jsonRequest("POST", {
            expectedVersionId: flags.versionId,
            inputs: await readWorkflowInputs(flags.inputs),
            query: await readWorkflowQuery(flags.query),
          }),
        );
        printWorkflowPreflight(ctx, preflight);
      },
    }),
    command("workflow list", {
      summary: "List saved workflows",
      flags: mailboxFlag,
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const workflows = await readApi<MailWorkflow[]>(ctx, `/mailboxes/${mailbox.id}/workflows`);
        printTable(
          ctx,
          workflows,
          workflows.map((workflow) => ({
            name: workflow.name,
            enabled: workflow.enabled ? "yes" : "no",
            current: workflow.currentVersionId,
            active: workflow.activeVersionId ?? "",
            updated: workflow.updatedAt,
            id: workflow.id,
          })),
          [
            { key: "name", label: "NAME" },
            { key: "enabled", label: "ENABLED" },
            { key: "current", label: "CURRENT VERSION ID" },
            { key: "active", label: "ACTIVE VERSION ID" },
            { key: "updated", label: "UPDATED" },
            { key: "id", label: "WORKFLOW ID" },
          ],
        );
      },
    }),
    command("workflow get", {
      summary: "Show a saved workflow and its current immutable version",
      args: { workflowId: arg.required({ description: "Workflow id" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const workflow = await readApi<MailWorkflowDetail>(ctx, `/mailboxes/${mailbox.id}/workflows/${args.workflowId}`);
        if (printStructured(ctx, workflow)) return;
        else {
          ctx.print(`${workflow.name} (${workflow.id})`);
          ctx.print(`Current version: ${workflow.currentVersion.id}; source hash: ${workflow.currentVersion.sourceHash}`);
          ctx.print(`Active version: ${workflow.activeVersionId ?? "none"}`);
          ctx.print(workflow.currentVersion.source);
        }
      },
    }),
    command("workflow create", {
      summary: "Create a saved workflow from exact YAML source",
      flags: {
        ...mailboxFlag,
        ...workflowEffectBudgetFlags,
        source: workflowSourceInput,
        name: flag.string({ required: true, description: "Workflow name stored outside YAML source" }),
        description: flag.string({ description: "Workflow description stored outside YAML source" }),
        priority: flag.int({ min: -1_000, max: 1_000, default: 100, description: "Mail ordering priority stored outside YAML source" }),
      },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const workflow = await readApi<MailWorkflowDetail>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows`,
          jsonRequest("POST", {
            name: flags.name,
            description: flags.description ?? null,
            priority: flags.priority ?? 100,
            source: await readWorkflowSource(flags.source),
            effectBudget: workflowEffectBudget(flags),
          }),
        );
        if (printStructured(ctx, workflow)) return;
        else ctx.print(`Created ${workflow.name} (${workflow.id}) at version ${workflow.currentVersion.id}.`);
      },
    }),
    command("workflow version list", {
      summary: "List immutable versions of a saved workflow",
      args: { workflowId: arg.required({ description: "Workflow id" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const versions = await readApi<MailWorkflowVersion[]>(ctx, `/mailboxes/${mailbox.id}/workflows/${args.workflowId}/versions`);
        printTable(
          ctx,
          versions,
          versions.map((version) => ({
            identity: version.identity,
            created: version.createdAt,
            hash: version.sourceHash,
            id: version.id,
          })),
          [
            { key: "identity", label: "IDENTITY" },
            { key: "created", label: "CREATED" },
            { key: "hash", label: "SOURCE HASH" },
            { key: "id", label: "VERSION ID" },
          ],
        );
      },
    }),
    command("workflow version create", {
      summary: "Create the next immutable version of a saved workflow",
      args: { workflowId: arg.required({ description: "Workflow id" }) },
      flags: { ...mailboxFlag, ...workflowEffectBudgetFlags, source: workflowSourceInput },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const workflow = await readApi<MailWorkflowDetail>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows/${args.workflowId}/versions`,
          jsonRequest("POST", { source: await readWorkflowSource(flags.source), effectBudget: workflowEffectBudget(flags) }),
        );
        if (printStructured(ctx, workflow)) return;
        else ctx.print(`Created ${workflow.name} version ${workflow.currentVersion.id}.`);
      },
    }),
    command("workflow version get", {
      summary: "Show one immutable workflow version",
      args: {
        workflowId: arg.required({ description: "Workflow id" }),
        versionId: arg.required({ description: "Immutable version id" }),
      },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const version = await readApi<MailWorkflowVersion>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows/${args.workflowId}/versions/${args.versionId}`,
        );
        if (printStructured(ctx, version)) return;
        else {
          ctx.print(`Version: ${version.id}; source hash: ${version.sourceHash}`);
          ctx.print(version.source);
        }
      },
    }),
    command("workflow activate", {
      summary: "Activate the current workflow version and register its automatic triggers",
      args: { workflowId: arg.required({ description: "Workflow id" }) },
      flags: {
        ...mailboxFlag,
        versionId: flag.string({ name: "version-id", required: true, description: "Current workflow version id expected by activation" }),
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const workflow = await readApi<MailWorkflowDetail>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows/${args.workflowId}/activate`,
          jsonRequest("POST", { expectedVersionId: flags.versionId }),
        );
        if (printStructured(ctx, workflow)) return;
        else ctx.print(`Activated ${workflow.name} at version ${workflow.activeVersionId}.`);
      },
    }),
    command("workflow deactivate", {
      summary: "Deactivate the active workflow version without mutating historical runs",
      args: { workflowId: arg.required({ description: "Workflow id" }) },
      flags: {
        ...mailboxFlag,
        versionId: flag.string({ name: "version-id", required: true, description: "Active workflow version id expected by deactivation" }),
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const workflow = await readApi<MailWorkflowDetail>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows/${args.workflowId}/deactivate`,
          jsonRequest("POST", { expectedVersionId: flags.versionId }),
        );
        if (printStructured(ctx, workflow)) return;
        else ctx.print(`Deactivated ${workflow.name}.`);
      },
    }),
    command("workflow run one-shot", {
      summary: "Preflight and execute a saved workflow as a one-shot run",
      args: { workflowId: arg.required({ description: "Workflow id" }) },
      flags: {
        ...mailboxFlag,
        versionId: flag.string({ name: "version-id", required: true, description: "Immutable workflow version id to execute" }),
        query: workflowQueryInput,
        inputs: workflowInputsInput,
        idempotencyKey: flag.string({ name: "idempotency-key", description: "Stable client retry key" }),
        yes: confirmFlag("Confirm workflow effects"),
        wait: flag.boolean({ description: "Wait for the workflow run to finish" }),
        ...waitFlags,
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = await readWorkflowQuery(flags.query);
        const inputs = await readWorkflowInputs(flags.inputs);
        const preflight = await readApi<MailWorkflowPreflight>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows/${args.workflowId}/preflight`,
          jsonRequest("POST", { expectedVersionId: flags.versionId, inputs, query }),
        );
        if (!flags.yes) {
          printWorkflowPreflight(ctx, preflight);
          throw new Error("Pass --yes to execute the preflighted workflow effects.");
        }
        const queued = await readApi<MailWorkflowRun>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows/${args.workflowId}/one-shot`,
          workflowRunRequest({
            expectedVersionId: flags.versionId,
            inputs,
            query,
            preflightHash: preflight.preflightHash,
            occurredAt: preflight.occurredAt,
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
          }),
        );
        const run = flags.wait ? await waitForWorkflowRun(ctx, mailbox.id, queued.id, flags.timeoutSeconds) : queued;
        if (flags.wait && run.state !== "succeeded") return printWorkflowWaitFailure(ctx, run, { preflight, run });
        if (printStructured(ctx, { preflight, run })) return;
        else ctx.print(`${flags.wait ? "Completed" : "Queued"} workflow run ${run.id} (${run.state}).`);
      },
    }),
    command("workflow run dry-run", {
      summary: "Plan a saved workflow without applying effects",
      args: { workflowId: arg.required({ description: "Workflow id" }) },
      flags: {
        ...mailboxFlag,
        versionId: flag.string({ name: "version-id", required: true, description: "Immutable workflow version id to plan" }),
        query: workflowQueryInput,
        inputs: workflowInputsInput,
        idempotencyKey: flag.string({ name: "idempotency-key", description: "Stable client retry key" }),
        wait: flag.boolean({ description: "Wait for planning to finish" }),
        ...waitFlags,
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const run = await readApi<MailWorkflowRun>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows/${args.workflowId}/dry-run`,
          workflowRunRequest({
            expectedVersionId: flags.versionId,
            inputs: await readWorkflowInputs(flags.inputs),
            query: await readWorkflowQuery(flags.query),
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
          }),
        );
        const result = flags.wait ? await waitForWorkflowRun(ctx, mailbox.id, run.id, flags.timeoutSeconds) : run;
        if (flags.wait && result.state !== "succeeded") return printWorkflowWaitFailure(ctx, result);
        if (printStructured(ctx, result)) return;
        else ctx.print(`${flags.wait ? "Completed" : "Queued"} workflow dry run ${result.id} (${result.state}).`);
      },
    }),
    command("workflow run invoke", {
      summary: "Preflight and execute a saved workflow through the direct invocation channel",
      args: { workflowId: arg.required({ description: "Workflow id" }) },
      flags: {
        ...mailboxFlag,
        versionId: flag.string({ name: "version-id", required: true, description: "Immutable workflow version id to execute" }),
        query: workflowQueryInput,
        inputs: workflowInputsInput,
        idempotencyKey: flag.string({ name: "idempotency-key", description: "Stable client retry key" }),
        yes: confirmFlag("Confirm workflow effects"),
        wait: flag.boolean({ description: "Wait for the workflow run to finish" }),
        ...waitFlags,
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = await readWorkflowQuery(flags.query);
        const inputs = await readWorkflowInputs(flags.inputs);
        const preflight = await readApi<MailWorkflowPreflight>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows/${args.workflowId}/preflight`,
          jsonRequest("POST", { expectedVersionId: flags.versionId, inputs, query }),
        );
        if (!flags.yes) {
          printWorkflowPreflight(ctx, preflight);
          throw new Error("Pass --yes to execute the preflighted workflow effects.");
        }
        const queued = await readApi<MailWorkflowRun>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows/${args.workflowId}/invoke`,
          workflowRunRequest({
            expectedVersionId: flags.versionId,
            inputs,
            query,
            preflightHash: preflight.preflightHash,
            occurredAt: preflight.occurredAt,
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
          }),
        );
        const run = flags.wait ? await waitForWorkflowRun(ctx, mailbox.id, queued.id, flags.timeoutSeconds) : queued;
        if (flags.wait && run.state !== "succeeded") return printWorkflowWaitFailure(ctx, run, { preflight, run });
        if (printStructured(ctx, { preflight, run })) return;
        else ctx.print(`${flags.wait ? "Completed" : "Queued"} workflow run ${run.id} (${run.state}).`);
      },
    }),
    command("workflow run backfill", {
      summary: "Preflight and execute a saved workflow over a backfill target set",
      args: { workflowId: arg.required({ description: "Workflow id" }) },
      flags: {
        ...mailboxFlag,
        versionId: flag.string({ name: "version-id", required: true, description: "Immutable workflow version id to execute" }),
        query: workflowQueryInput,
        inputs: workflowInputsInput,
        idempotencyKey: flag.string({ name: "idempotency-key", description: "Stable client retry key" }),
        yes: confirmFlag("Confirm workflow effects"),
        wait: flag.boolean({ description: "Wait for the workflow run to finish" }),
        ...waitFlags,
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = await readWorkflowQuery(flags.query);
        const inputs = await readWorkflowInputs(flags.inputs);
        const preflight = await readApi<MailWorkflowPreflight>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows/${args.workflowId}/preflight`,
          jsonRequest("POST", { expectedVersionId: flags.versionId, inputs, query }),
        );
        if (!flags.yes) {
          printWorkflowPreflight(ctx, preflight);
          throw new Error("Pass --yes to execute the preflighted workflow effects.");
        }
        const queued = await readApi<MailWorkflowRun>(
          ctx,
          `/mailboxes/${mailbox.id}/workflows/${args.workflowId}/backfill`,
          workflowRunRequest({
            expectedVersionId: flags.versionId,
            inputs,
            query,
            preflightHash: preflight.preflightHash,
            occurredAt: preflight.occurredAt,
            idempotencyKey: flags.idempotencyKey ?? crypto.randomUUID(),
          }),
        );
        const run = flags.wait ? await waitForWorkflowRun(ctx, mailbox.id, queued.id, flags.timeoutSeconds) : queued;
        if (flags.wait && run.state !== "succeeded") return printWorkflowWaitFailure(ctx, run, { preflight, run });
        if (printStructured(ctx, { preflight, run })) return;
        else ctx.print(`${flags.wait ? "Completed" : "Queued"} workflow run ${run.id} (${run.state}).`);
      },
    }),
    command("workflow run list", {
      summary: "List recent workflow runs",
      flags: {
        ...mailboxFlag,
        workflow: flag.string({ description: "Optional workflow id" }),
        limit: flag.int({ min: 1, max: 200, default: 50 }),
      },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = new URLSearchParams({ limit: String(flags.limit ?? 50) });
        if (flags.workflow) query.set("workflowId", flags.workflow);
        const runs = await readApi<MailWorkflowRun[]>(ctx, `/mailboxes/${mailbox.id}/workflow-runs?${query}`);
        printTable(
          ctx,
          runs,
          runs.map((run) => ({
            created: run.createdAt,
            state: run.state,
            targets: workflowProgressText(run),
            workflow: run.workflowId,
            id: run.id,
          })),
          [
            { key: "created", label: "CREATED" },
            { key: "state", label: "STATE" },
            { key: "targets", label: "TARGETS" },
            { key: "workflow", label: "WORKFLOW ID" },
            { key: "id", label: "RUN ID" },
          ],
        );
      },
    }),
    command("workflow run get", {
      summary: "Inspect a durable workflow run",
      args: { runId: arg.required({ description: "Workflow run id" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const run = await readApi<MailWorkflowRun>(ctx, `/mailboxes/${mailbox.id}/workflow-runs/${args.runId}`);
        if (printStructured(ctx, run)) return;
        else ctx.print(`${run.state}: ${workflowProgressText(run)}${workflowLastErrorText(run)}`);
      },
    }),
    command("workflow run targets", {
      summary: "Inspect workflow run targets using an ordinal cursor",
      args: { runId: arg.required({ description: "Workflow run id" }) },
      flags: {
        ...mailboxFlag,
        after: flag.int({ min: -1, default: -1, description: "Return targets after this ordinal" }),
        limit: flag.int({ min: 1, max: 200, default: 100 }),
      },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = new URLSearchParams({
          afterOrdinal: String(flags.after ?? -1),
          limit: String(flags.limit ?? 100),
        });
        const targets = await readApi<MailWorkflowRunTarget[]>(
          ctx,
          `/mailboxes/${mailbox.id}/workflow-runs/${args.runId}/targets?${query}`,
        );
        printTable(
          ctx,
          targets,
          targets.map((target) => ({
            ordinal: target.ordinal,
            state: target.state,
            key: target.targetKey,
            error: target.lastError?.message ?? "",
            id: target.id,
          })),
          [
            { key: "ordinal", label: "ORDINAL" },
            { key: "state", label: "STATE" },
            { key: "key", label: "TARGET" },
            { key: "error", label: "ERROR" },
            { key: "id", label: "TARGET ID" },
          ],
        );
      },
    }),
    command("workflow run wait", {
      summary: "Wait for a workflow run to succeed",
      args: { runId: arg.required({ description: "Workflow run id" }) },
      flags: { ...mailboxFlag, ...waitFlags },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const run = await waitForWorkflowRun(ctx, mailbox.id, args.runId, flags.timeoutSeconds);
        if (run.state !== "succeeded") return printWorkflowWaitFailure(ctx, run);
        if (printStructured(ctx, run)) return;
        else ctx.print(`Workflow run ${run.id} succeeded (${workflowProgressText(run)}).`);
      },
    }),
    command("workflow run cancel", {
      summary: "Cancel queued, running, or waiting workflow targets",
      args: { runId: arg.required({ description: "Workflow run id" }) },
      flags: {
        ...mailboxFlag,
        reason: flag.string({ description: "Optional operator-visible cancellation reason" }),
        yes: confirmFlag("Confirm workflow run cancellation"),
      },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Pass --yes to cancel the workflow run.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const run = await readApi<MailWorkflowRun>(
          ctx,
          `/mailboxes/${mailbox.id}/workflow-runs/${args.runId}/cancel`,
          jsonRequest("POST", { reason: flags.reason }),
        );
        if (printStructured(ctx, run)) return;
        else ctx.print(`Workflow run ${run.id} is ${run.state}.`);
      },
    }),
    command("command list", {
      summary: "List recent durable commands",
      flags: { ...mailboxFlag, limit: flag.int({ min: 1, max: 200, default: 100 }) },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const commands = await readApi<MailCommand[]>(ctx, `/mailboxes/${mailbox.id}/commands?limit=${flags.limit ?? 100}`);
        printTable(
          ctx,
          commands,
          commands.map((item) => ({
            created: item.createdAt,
            kind: item.kind,
            state: item.state,
            attempt: item.attempt,
            id: item.id,
          })),
          [
            { key: "created", label: "CREATED" },
            { key: "kind", label: "KIND" },
            { key: "state", label: "STATE" },
            { key: "attempt", label: "ATTEMPT" },
            { key: "id", label: "COMMAND ID" },
          ],
        );
      },
    }),
    command("command get", {
      summary: "Inspect a durable command",
      args: { commandId: arg.required() },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const result = await readApi<MailCommand>(ctx, `/mailboxes/${mailbox.id}/commands/${args.commandId}`);
        if (ctx.options.output === "json") ctx.json(result);
        else {
          ctx.print(`${result.kind}: ${result.state}${result.lastError ? ` - ${result.lastError}` : ""}`);
          if (result.transportMetadata.expungePending === true) {
            ctx.print("The source is safely marked \\Deleted; this provider cannot expunge only that UID.");
          }
          if (Object.keys(result.result).length > 0) ctx.print(JSON.stringify(result.result, null, 2));
        }
      },
    }),
    command("command wait", {
      summary: "Wait for a durable command to succeed",
      args: { commandId: arg.required() },
      flags: { ...mailboxFlag, ...waitFlags },
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const result = await waitForCommand(ctx, mailbox.id, args.commandId, flags.timeoutSeconds);
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`${result.kind}: ${result.state} (${result.id}).`);
      },
    }),
    command("command cancel", {
      summary: "Cancel a scheduled send during its undo window",
      args: { commandId: arg.required({ description: "Send command id" }) },
      flags: mailboxFlag,
      run: async ({ ctx, args, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        await readApi(ctx, `/mailboxes/${mailbox.id}/commands/${args.commandId}/cancel`, { method: "POST" });
        if (ctx.options.output === "json") ctx.json({ cancelled: true, commandId: args.commandId });
        else ctx.print(`Cancelled send command ${args.commandId}.`);
      },
    }),
    command("delete", {
      summary: "Delete a mailbox resource (provider mail remains untouched)",
      args: { mailbox: arg.required() },
      flags: { yes: confirmFlag("Confirm mailbox deletion") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Pass --yes to delete the mailbox resource.");
        const mailbox = await resolveMailbox(ctx, args.mailbox);
        await readApi(ctx, `/mailboxes/${mailbox.id}`, { method: "DELETE" });
        if (ctx.options.output === "json") ctx.json({ deleted: true, mailboxId: mailbox.id });
        else ctx.print(`Deleted ${mailbox.name}.`);
      },
    }),
    ...mailboxAccessCommands,
  ],
});
