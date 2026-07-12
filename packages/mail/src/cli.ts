import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
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
import {
  type Mailbox,
  type MailboxHealth,
  type MailCommand,
  type MailDraft,
  type MailSearchExpression,
  mailSearchExpressionSchema,
  type ProviderBinding,
  type ProviderConnection,
  type SenderIdentity,
} from "./contracts";
import type { ConversationSummary, MailFolderView, MessageDetail, MessageSummary } from "./service/messages";
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
const apiPath = (path = "") => `/api/mail${path}`;
const readApi = async <T>(ctx: CloudCliContext, path: string, init?: RequestInit): Promise<T> =>
  ctx.readJson<T>(await ctx.fetch(apiPath(path), init));
const jsonRequest = (method: string, value: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

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

const pollUntil = async <T>(params: {
  load: () => Promise<T>;
  done: (value: T) => boolean;
  timeoutSeconds: number | undefined;
  description: string;
}): Promise<T> => {
  const timeoutMs = (params.timeoutSeconds ?? DEFAULT_WAIT_TIMEOUT_SECONDS) * 1_000;
  const deadline = Date.now() + timeoutMs;
  const pollIntervalMs = Math.min(1_000, Math.max(100, Math.floor(timeoutMs / 20)));
  while (true) {
    const value = await params.load();
    if (params.done(value)) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${params.description}.`);
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
  else ctx.table(rows, columns);
};

const listMailboxes = (ctx: CloudCliContext): Promise<MailboxWithPermission[]> => readApi(ctx, "/mailboxes?limit=200");
const getMailbox = (ctx: CloudCliContext, mailboxId: string): Promise<Mailbox> => readApi(ctx, `/mailboxes/${mailboxId}`);

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

const draftContentFlags = {
  identity: flag.string({ required: true, description: "Sender identity id" }),
  to: flag.stringList({ description: "Recipient; repeatable" }),
  cc: flag.stringList({ description: "Cc recipient; repeatable" }),
  bcc: flag.stringList({ description: "Bcc recipient; repeatable" }),
  conversation: flag.string({ description: "Conversation id when replying" }),
  subject: flag.string({ description: "Message subject" }),
  body: flag.input({ required: true, fileName: "body-file", stdinName: "body-stdin", description: "Plaintext or Markdown body" }),
  format: flag.enum(["plain", "markdown"] as const, { default: "markdown" }),
};

const readDraftContent = async (flags: {
  identity?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  conversation?: string;
  subject?: string;
  body: Parameters<typeof readCliInput>[0];
  format?: "plain" | "markdown";
}) => {
  if (!flags.identity) throw new Error("Missing sender identity.");
  const body = await readCliInput(flags.body, { label: "message body", required: true });
  return {
    conversationId: flags.conversation,
    senderIdentityId: flags.identity,
    to: parseAddresses(flags.to),
    cc: parseAddresses(flags.cc),
    bcc: parseAddresses(flags.bcc),
    subject: flags.subject ?? "",
    body: body ?? "",
    format: flags.format ?? "markdown",
  };
};

const createDraft = async (ctx: CloudCliContext, mailboxId: string, flags: Parameters<typeof readDraftContent>[0]): Promise<MailDraft> =>
  readApi(ctx, `/mailboxes/${mailboxId}/drafts`, jsonRequest("POST", await readDraftContent(flags)));

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

const commandResult = async (ctx: CloudCliContext, mailbox: Mailbox, input: Record<string, unknown>): Promise<MailCommand> => {
  const result = await readApi<MailCommand>(ctx, `/mailboxes/${mailbox.id}/commands`, jsonRequest("POST", input));
  if (ctx.options.output === "json") ctx.json(result);
  else ctx.print(`${result.kind}: ${result.state} (${result.id}).`);
  return result;
};

const loadCommand = (ctx: CloudCliContext, mailboxId: string, commandId: string): Promise<MailCommand> =>
  readApi(ctx, `/mailboxes/${mailboxId}/commands/${commandId}`);

const waitForCommand = async (
  ctx: CloudCliContext,
  mailboxId: string,
  commandId: string,
  timeoutSeconds?: number,
): Promise<MailCommand> => {
  const result = await pollUntil({
    load: () => loadCommand(ctx, mailboxId, commandId),
    done: (value) => !COMMAND_PENDING_STATES.has(value.state),
    timeoutSeconds,
    description: `mail command ${commandId}`,
  });
  if (!COMMAND_SUCCESS_STATES.has(result.state)) {
    throw new Error(`Mail command ${result.id} ended in ${result.state}${result.lastError ? `: ${result.lastError}` : "."}`);
  }
  return result;
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
): Promise<MessageSearchPage> => readApi(ctx, `/mailboxes/${mailboxId}/search`, jsonRequest("POST", request));

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
          load: () => getMailbox(ctx, resolved.id),
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
      summary: "Show mailbox health and bindings",
      flags: mailboxFlag,
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const bindings = await readApi<ProviderBinding[]>(ctx, `/mailboxes/${mailbox.id}/bindings`);
        if (ctx.options.output === "json") ctx.json({ mailbox, bindings });
        else {
          ctx.print(`${mailbox.name}: ${mailbox.health}${mailbox.healthReason ? ` - ${mailbox.healthReason}` : ""}`);
          ctx.table(
            bindings.map((binding) => ({ state: binding.state, principal: binding.authenticatedPrincipal ?? "", id: binding.id })),
            [
              { key: "state", label: "STATE" },
              { key: "principal", label: "PRINCIPAL" },
              { key: "id", label: "BINDING ID" },
            ],
          );
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
            total: folder.total,
            unread: folder.unread,
            status: folder.syncStatus,
            id: folder.id,
          })),
          [
            { key: "name", label: "NAME" },
            { key: "role", label: "ROLE" },
            { key: "total", label: "TOTAL" },
            { key: "unread", label: "UNREAD" },
            { key: "status", label: "SYNC" },
            { key: "id", label: "ID" },
          ],
        );
      },
    }),
    command("sync", {
      summary: "Queue synchronization for a mailbox",
      flags: mailboxFlag,
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const result = await readApi<{ queuedFolders: number }>(ctx, `/mailboxes/${mailbox.id}/sync`, { method: "POST" });
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Queued ${result.queuedFolders} folder(s).`);
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
          load: async () => (await searchMessages(ctx, mailbox.id, { expression, sort: "newest", limit: 1 })).items[0] ?? null,
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
        cursor: flag.string({ description: "Opaque cursor returned by a previous page" }),
        limit: flag.int({ min: 1, max: 100, default: 50 }),
      },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const query = new URLSearchParams({ limit: String(flags.limit ?? 50) });
        if (flags.folder) query.set("folderId", flags.folder);
        if (flags.status) query.set("status", flags.status);
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
            participants: thread.participantSummary,
            subject: thread.subject,
            id: thread.id,
          })),
          [
            { key: "date", label: "DATE" },
            { key: "unread", label: "UNREAD" },
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
        ...draftContentFlags,
        revision: flag.int({ required: true, min: 1, description: "Expected current revision" }),
      },
      run: async ({ ctx, args, flags }) => {
        if (flags.revision === undefined) throw new Error("Missing expected draft revision.");
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const draft = await readApi<MailDraft>(
          ctx,
          `/mailboxes/${mailbox.id}/drafts/${args.draftId}`,
          jsonRequest("PUT", { expectedRevision: flags.revision, draft: await readDraftContent(flags) }),
        );
        if (ctx.options.output === "json") ctx.json(draft);
        else ctx.print(`Updated draft ${draft.id} to revision ${draft.revision}.`);
      },
    }),
    command("send", {
      summary: "Create an immutable draft snapshot and queue delivery",
      flags: {
        ...mailboxFlag,
        ...draftContentFlags,
        schedule: flag.string({ description: "Optional ISO send time" }),
        undo: flag.int({ min: 0, max: 60, default: 10, description: "Undo window in seconds" }),
        idempotencyKey: flag.string({ name: "idempotency-key", description: "Stable client retry key" }),
        wait: flag.boolean({ description: "Wait for a successful terminal command state" }),
        ...waitFlags,
      },
      run: async ({ ctx, flags }) => {
        const mailbox = await resolveMailbox(ctx, flags.mailbox);
        const draft = await createDraft(ctx, mailbox.id, flags);
        const command = await readApi<MailCommand>(
          ctx,
          `/mailboxes/${mailbox.id}/commands`,
          jsonRequest("POST", {
            kind: "send",
            draftId: draft.id,
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
