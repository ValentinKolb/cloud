import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  type FetchMessageObject,
  ImapFlow,
  type ImapFlowOptions,
  type ListResponse,
  type MessageAddressObject,
  type MessageStructureObject,
} from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type {
  ConnectorCapabilities,
  ConnectorVerification,
  FolderRole,
  ProviderConnectionInput,
  RemoteFolder,
  RemoteNamespace,
} from "../../contracts";
import type {
  ConnectorAddress,
  ConnectorEnvelope,
  EnvelopeBatch,
  EnvelopeBatchRequest,
  FlagChange,
  FolderStatusSnapshot,
  MailConnector,
  RemoteAppendResult,
  RemoteCopyResult,
  RemoteMessageState,
  RemoteMutationTarget,
  SendRequest,
  SendResult,
  SendSourceRequest,
  SourceDownload,
  SourceDownloadRequest,
} from "./contract";
import { createPinnedLookup, type ResolvedEndpoint, resolvePublicEndpoint } from "./endpoint-policy";

type NamespaceEntry = { prefix: string; delimiter: string | null };
type ImapFlowNamespaces = {
  personal?: NamespaceEntry[] | false;
  other?: NamespaceEntry[] | false;
  shared?: NamespaceEntry[] | false;
};
type ImapFlowWithNamespaces = ImapFlow & { namespaces?: ImapFlowNamespaces };

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const authForImap = (config: ProviderConnectionInput): NonNullable<ImapFlowOptions["auth"]> =>
  config.secret.kind === "password"
    ? { user: config.username, pass: config.secret.password }
    : { user: config.username, accessToken: config.secret.accessToken };

const authForSmtp = (config: ProviderConnectionInput): SMTPTransport.Options["auth"] =>
  config.secret.kind === "password"
    ? { user: config.username, pass: config.secret.password }
    : { type: "OAuth2", user: config.username, accessToken: config.secret.accessToken };

const createImapClient = (config: ProviderConnectionInput, endpoint: ResolvedEndpoint): ImapFlow =>
  new ImapFlow({
    host: endpoint.host,
    port: endpoint.port,
    secure: endpoint.tlsMode === "implicit",
    doSTARTTLS: endpoint.tlsMode === "starttls",
    servername: isIP(endpoint.host) ? undefined : endpoint.host,
    auth: authForImap(config),
    clientInfo: { name: "Cloud Mail", vendor: "Cloud", version: "1" },
    logger: false,
    logRaw: false,
    emitLogs: false,
    disableCompression: true,
    disableAutoIdle: true,
    qresync: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    maxLineLength: 8 * 1024 * 1024,
    maxLiteralSize: 128 * 1024 * 1024,
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      lookup: createPinnedLookup(endpoint),
    },
  });

const withImapClient = async <T>(config: ProviderConnectionInput, fn: (client: ImapFlowWithNamespaces) => Promise<T>): Promise<T> => {
  const endpoint = await resolvePublicEndpoint(config.imap);
  const client = createImapClient(config, endpoint) as ImapFlowWithNamespaces;
  try {
    await client.connect();
    return await fn(client);
  } finally {
    if (client.usable) {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    } else {
      client.close();
    }
  }
};

const capability = (client: ImapFlow, name: string): boolean => client.capabilities.has(name) || client.enabled.has(name);

const mapCapabilities = (client: ImapFlow): ConnectorCapabilities => ({
  idle: capability(client, "IDLE"),
  condstore: capability(client, "CONDSTORE"),
  qresync: capability(client, "QRESYNC"),
  move: capability(client, "MOVE"),
  uidplus: capability(client, "UIDPLUS"),
  namespace: capability(client, "NAMESPACE"),
  listExtended: capability(client, "LIST-EXTENDED"),
  specialUse: capability(client, "SPECIAL-USE"),
  acl: capability(client, "ACL"),
  notify: capability(client, "NOTIFY"),
  gmailExtensions: capability(client, "X-GM-EXT-1"),
});

const mapNamespaces = (client: ImapFlowWithNamespaces): RemoteNamespace[] => {
  const namespaces = client.namespaces;
  const mapped: RemoteNamespace[] = [];
  for (const entry of namespaces?.personal || []) mapped.push({ kind: "personal", prefix: entry.prefix, delimiter: entry.delimiter });
  for (const entry of namespaces?.other || []) mapped.push({ kind: "other_users", prefix: entry.prefix, delimiter: entry.delimiter });
  for (const entry of namespaces?.shared || []) mapped.push({ kind: "shared", prefix: entry.prefix, delimiter: entry.delimiter });
  return mapped.length > 0 ? mapped : [{ kind: "personal", prefix: "", delimiter: null }];
};

const verifyImap = async (
  config: ProviderConnectionInput,
): Promise<Omit<ConnectorVerification, "accounts"> & { namespaces: RemoteNamespace[] }> =>
  withImapClient(config, async (client) => ({
    authenticatedPrincipal: typeof client.authenticated === "string" ? client.authenticated : config.username,
    serverIdentity: {
      host: config.imap.host,
      port: config.imap.port,
      tlsMode: config.imap.tlsMode,
      secureConnection: client.secureConnection,
      serverInfo: client.serverInfo ?? {},
      advertisedCapabilities: [...client.capabilities.keys()].sort(),
    },
    capabilities: mapCapabilities(client),
    namespaces: mapNamespaces(client),
  }));

const smtpOptions = (config: ProviderConnectionInput, endpoint: ResolvedEndpoint, address: string): SMTPTransport.Options => ({
  host: address,
  port: endpoint.port,
  secure: endpoint.tlsMode === "implicit",
  requireTLS: endpoint.tlsMode === "starttls",
  ignoreTLS: false,
  auth: authForSmtp(config),
  name: "cloud-mail",
  logger: false,
  debug: false,
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  socketTimeout: 60_000,
  disableFileAccess: true,
  disableUrlAccess: true,
  tls: {
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    servername: isIP(endpoint.host) ? undefined : endpoint.host,
  },
});

const withSmtpTransport = async <T>(
  config: ProviderConnectionInput,
  fn: (transport: nodemailer.Transporter<SMTPTransport.SentMessageInfo>) => Promise<T>,
  options: { allowAddressFailover?: boolean } = {},
): Promise<T> => {
  const endpoint = await resolvePublicEndpoint(config.smtp);
  let lastError: unknown;
  const addresses = options.allowAddressFailover ? endpoint.addresses : endpoint.addresses.slice(0, 1);
  for (const resolved of addresses) {
    const transport = nodemailer.createTransport(smtpOptions(config, endpoint, resolved.address));
    try {
      return await fn(transport);
    } catch (error) {
      lastError = error;
    } finally {
      transport.close();
    }
  }
  throw lastError ?? new Error("SMTP endpoint did not provide a usable address");
};

const verifySmtp = async (config: ProviderConnectionInput): Promise<void> =>
  withSmtpTransport(
    config,
    async (transport) => {
      await transport.verify();
    },
    { allowAddressFailover: true },
  );

const roleFromList = (entry: ListResponse): FolderRole => {
  if (entry.path.toUpperCase() === "INBOX") return "inbox";
  switch (entry.specialUse?.toLowerCase()) {
    case "\\sent":
      return "sent";
    case "\\drafts":
      return "drafts";
    case "\\trash":
      return "trash";
    case "\\archive":
      return "archive";
    case "\\junk":
      return "junk";
    case "\\all":
      return "all";
    default:
      return "other";
  }
};

const stableFolderKey = (entry: ListResponse): string => sha256(`${entry.path}\n${entry.status?.uidValidity?.toString() ?? "unknown"}`);

const mapFolder = (entry: ListResponse): RemoteFolder => ({
  stableKey: stableFolderKey(entry),
  path: entry.path,
  name: entry.name || entry.path,
  delimiter: entry.delimiter || null,
  parentPath: entry.parentPath || null,
  role: roleFromList(entry),
  subscribed: entry.subscribed,
  selectable: !entry.flags.has("\\Noselect"),
  uidValidity: entry.status?.uidValidity?.toString() ?? null,
  uidNext: entry.status?.uidNext?.toString() ?? null,
  highestModseq: entry.status?.highestModseq?.toString() ?? null,
  rights: [],
});

const normalizeRoot = (rootPath: string | null | undefined): string | null => {
  const trimmed = rootPath?.trim();
  return trimmed ? trimmed : null;
};

const isWithinRoot = (folder: ListResponse, root: string): boolean =>
  folder.path === root || Boolean(folder.delimiter && folder.path.startsWith(`${root}${folder.delimiter}`));

const mapAddress = (address: MessageAddressObject): ConnectorAddress | null => {
  const normalized = address.address?.trim().toLowerCase();
  return normalized ? { name: address.name?.trim() || null, address: normalized } : null;
};

const mapAddresses = (addresses: MessageAddressObject[] | undefined): ConnectorAddress[] =>
  (addresses ?? []).map(mapAddress).filter((address): address is ConnectorAddress => address !== null);

const structureToJson = (structure: MessageStructureObject | undefined): Record<string, unknown> => {
  if (!structure) return {};
  return {
    part: structure.part ?? null,
    type: structure.type,
    parameters: structure.parameters ?? {},
    id: structure.id ?? null,
    encoding: structure.encoding ?? null,
    size: structure.size ?? null,
    disposition: structure.disposition ?? null,
    dispositionParameters: structure.dispositionParameters ?? {},
    childNodes: structure.childNodes?.map((child) => structureToJson(child)) ?? [],
  };
};

export const parseReferences = async (headers: Buffer | undefined): Promise<string[]> => {
  if (!headers?.length) return [];
  const parsed = await simpleParser(headers, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
  if (Array.isArray(parsed.references)) return parsed.references.map(String).filter(Boolean);
  if (typeof parsed.references === "string") {
    return parsed.references.match(/<[^>]+>/g) ?? parsed.references.split(/\s+/).filter(Boolean);
  }
  return [];
};

const mapFetchedEnvelope = async (message: FetchMessageObject, request: EnvelopeBatchRequest): Promise<ConnectorEnvelope> => {
  const envelope = message.envelope;
  return {
    remoteRef: {
      folderStableKey: request.folderStableKey,
      uidValidity: request.uidValidity,
      uid: String(message.uid),
      modseq: message.modseq?.toString() ?? null,
    },
    providerMessageId: message.emailId ?? null,
    providerThreadId: message.threadId ?? null,
    messageId: envelope?.messageId?.trim() || null,
    inReplyTo: envelope?.inReplyTo?.trim() || null,
    references: await parseReferences(message.headers),
    subject: envelope?.subject ?? "",
    sentAt: envelope?.date ?? null,
    internalDate: message.internalDate ? new Date(message.internalDate) : (envelope?.date ?? new Date(0)),
    sizeBytes: message.size ?? 0,
    flags: [...(message.flags ?? [])].sort(),
    labels: [...(message.labels ?? [])].sort(),
    addresses: {
      from: mapAddresses(envelope?.from),
      replyTo: mapAddresses(envelope?.replyTo),
      to: mapAddresses(envelope?.to),
      cc: mapAddresses(envelope?.cc),
      bcc: mapAddresses(envelope?.bcc),
    },
    mimeStructure: structureToJson(message.bodyStructure),
  };
};

export const selectUidBatch = async (params: {
  lowUid: number;
  highUid: number;
  limit: number;
  search: (lowUid: number, highUid: number) => Promise<number[]>;
}): Promise<{ uids: number[]; nextHighUid: number | null }> => {
  const lowUid = Math.max(1, Math.floor(params.lowUid));
  const highUid = Math.max(lowUid, Math.floor(params.highUid));
  const limit = Math.max(1, Math.floor(params.limit));
  let span = Math.min(highUid - lowUid + 1, limit * 4);

  while (true) {
    const probeLow = Math.max(lowUid, highUid - span + 1);
    const matches = [...new Set(await params.search(probeLow, highUid))]
      .filter((uid) => Number.isInteger(uid) && uid >= probeLow && uid <= highUid)
      .sort((left, right) => left - right);
    if (matches.length >= limit || probeLow === lowUid) {
      const uids = matches.slice(-limit);
      const firstUid = uids[0];
      return {
        uids,
        nextHighUid: probeLow === lowUid && matches.length <= limit ? null : firstUid != null && firstUid > lowUid ? firstUid - 1 : null,
      };
    }
    span = Math.min(highUid - lowUid + 1, span * 4);
  }
};

const verify = async (config: ProviderConnectionInput): Promise<ConnectorVerification> => {
  const [imap] = await Promise.all([verifyImap(config), verifySmtp(config)]);
  const accountId = sha256(`${config.imap.host.toLowerCase()}\n${imap.authenticatedPrincipal.toLowerCase()}`);
  return {
    authenticatedPrincipal: imap.authenticatedPrincipal,
    serverIdentity: imap.serverIdentity,
    capabilities: imap.capabilities,
    accounts: [
      {
        id: accountId,
        name: config.email,
        locator: { accountId, rootPath: "" },
        namespaces: imap.namespaces,
      },
    ],
  };
};

const discoverFolders = async (config: ProviderConnectionInput, rootPath?: string | null): Promise<RemoteFolder[]> =>
  withImapClient(config, async (client) => {
    const root = normalizeRoot(rootPath);
    const folders = await client.list({
      statusQuery: { messages: true, uidNext: true, uidValidity: true, unseen: true, highestModseq: true },
    });
    const selected = folders.filter((folder) => !root || isWithinRoot(folder, root));
    const result: RemoteFolder[] = [];
    for (const entry of selected) {
      const folder = mapFolder(entry);
      if (!folder.selectable) {
        result.push(folder);
        continue;
      }
      try {
        const lock = await client.getMailboxLock(entry.path, { readOnly: false });
        try {
          const readOnly = !client.mailbox || client.mailbox.readOnly === true;
          folder.rights = readOnly
            ? ["read"]
            : ["read", "write_flags", "insert", "copy", "move", ...(capability(client, "UIDPLUS") ? ["delete_messages"] : [])];
        } finally {
          lock.release();
        }
      } catch {
        folder.rights = [];
      }
      result.push(folder);
    }
    return result;
  });

const fetchEnvelopeBatch = async (config: ProviderConnectionInput, request: EnvelopeBatchRequest): Promise<EnvelopeBatch> =>
  withImapClient(config, async (client) => {
    const lock = await client.getMailboxLock(request.folderPath, { readOnly: true });
    try {
      const actualUidValidity = client.mailbox && client.mailbox.uidValidity.toString();
      if (!actualUidValidity || actualUidValidity !== request.uidValidity) {
        const error = Object.assign(new Error("Folder UIDVALIDITY changed"), {
          code: "UIDVALIDITY_CHANGED",
          expected: request.uidValidity,
          actual: actualUidValidity ?? null,
        });
        throw error;
      }
      const highUid = Math.max(1, request.highUid);
      const lowUid = Math.max(1, request.lowUid ?? 1);
      const selected = await selectUidBatch({
        lowUid,
        highUid,
        limit: request.limit,
        search: async (probeLow, probeHigh) => {
          const matches = await client.search({ uid: `${probeLow}:${probeHigh}` }, { uid: true });
          return matches || [];
        },
      });
      const fetched: FetchMessageObject[] = [];
      if (selected.uids.length > 0) {
        for await (const message of client.fetch(
          selected.uids,
          {
            uid: true,
            flags: true,
            envelope: true,
            bodyStructure: true,
            internalDate: true,
            size: true,
            threadId: true,
            labels: true,
            headers: ["references"],
          },
          { uid: true },
        )) {
          fetched.push(message);
        }
      }
      fetched.sort((left, right) => right.uid - left.uid);
      const messages = await Promise.all(fetched.map((message) => mapFetchedEnvelope(message, request)));
      return { messages, nextHighUid: selected.nextHighUid };
    } finally {
      lock.release();
    }
  });

const getFolderStatus = async (config: ProviderConnectionInput, folderPath: string): Promise<FolderStatusSnapshot> =>
  withImapClient(config, async (client) => {
    const status = await client.status(folderPath, {
      messages: true,
      uidNext: true,
      uidValidity: true,
      highestModseq: true,
    });
    if (!status.uidValidity || !status.uidNext) {
      throw Object.assign(new Error("Provider folder status is incomplete"), { code: "INCOMPLETE_FOLDER_STATUS" });
    }
    return {
      uidValidity: status.uidValidity.toString(),
      uidNext: status.uidNext,
      highestModseq: status.highestModseq?.toString() ?? null,
      messages: status.messages ?? 0,
    };
  });

const fetchFlagChanges = async (
  config: ProviderConnectionInput,
  folderPath: string,
  sinceModseq: string,
  lowUid: number,
  highUid: number,
): Promise<FlagChange[]> =>
  withImapClient(config, async (client) => {
    const lock = await client.getMailboxLock(folderPath, { readOnly: true });
    try {
      const changes: FlagChange[] = [];
      for await (const message of client.fetch(
        `${Math.max(1, lowUid)}:${Math.max(1, highUid)}`,
        { uid: true, flags: true, labels: true },
        { uid: true, changedSince: BigInt(sinceModseq) },
      )) {
        changes.push({
          uid: message.uid,
          modseq: message.modseq?.toString() ?? null,
          flags: [...(message.flags ?? [])].sort(),
          labels: [...(message.labels ?? [])].sort(),
        });
      }
      return changes;
    } finally {
      lock.release();
    }
  });

const fetchUidWindow = async (config: ProviderConnectionInput, folderPath: string, lowUid: number, highUid: number): Promise<number[]> =>
  withImapClient(config, async (client) => {
    const lock = await client.getMailboxLock(folderPath, { readOnly: true });
    try {
      const uids: number[] = [];
      for await (const message of client.fetch(`${Math.max(1, lowUid)}:${Math.max(1, highUid)}`, { uid: true }, { uid: true })) {
        uids.push(message.uid);
      }
      return uids.sort((left, right) => left - right);
    } finally {
      lock.release();
    }
  });

const downloadSourceBatch = async (
  config: ProviderConnectionInput,
  folderPath: string,
  requests: SourceDownloadRequest[],
  consume: (source: SourceDownload) => Promise<void>,
): Promise<void> =>
  withImapClient(config, async (client) => {
    if (requests.length === 0) return;
    const expectedUidValidities = new Set(requests.map((request) => request.uidValidity));
    if (expectedUidValidities.size !== 1) {
      throw Object.assign(new Error("Source batch contains multiple UIDVALIDITY values"), { code: "INVALID_SOURCE_BATCH" });
    }
    const lock = await client.getMailboxLock(folderPath, { readOnly: true });
    try {
      assertSelectedUidValidity(client, requests[0]!.uidValidity);
      for (const request of requests) {
        const download = await client.download(request.uid, undefined, { uid: true });
        try {
          await consume({
            ...request,
            expectedSize: download.meta.expectedSize,
            stream: download.content,
          });
        } finally {
          if (!download.content.destroyed) download.content.destroy();
        }
      }
    } finally {
      lock.release();
    }
  });

const send = async (config: ProviderConnectionInput, request: SendRequest): Promise<SendResult> =>
  withSmtpTransport(config, async (transport) => {
    const formatAddress = (address: { name?: string | null; address: string }) => ({
      name: address.name?.trim() ?? "",
      address: address.address,
    });
    const info = await transport.sendMail({
      from: formatAddress(request.from),
      replyTo: request.replyTo ?? undefined,
      envelope: request.envelopeFrom
        ? { from: request.envelopeFrom, to: [...request.to, ...(request.cc ?? []), ...(request.bcc ?? [])].map((item) => item.address) }
        : undefined,
      to: request.to.map(formatAddress),
      cc: request.cc?.map(formatAddress),
      bcc: request.bcc?.map(formatAddress),
      subject: request.subject,
      text: request.text,
      html: request.html ?? undefined,
      messageId: request.messageId,
      inReplyTo: request.inReplyTo ?? undefined,
      references: request.references,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    return {
      accepted: info.accepted.map(String),
      rejected: info.rejected.map(String),
      response: info.response,
      messageId: info.messageId,
    };
  });

const sendSource = async (config: ProviderConnectionInput, request: SendSourceRequest): Promise<SendResult> =>
  withSmtpTransport(config, async (transport) => {
    const info = await transport.sendMail({
      raw: request.source,
      envelope: { from: request.envelopeFrom, to: request.recipients },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    return {
      accepted: info.accepted.map(String),
      rejected: info.rejected.map(String),
      response: info.response,
      messageId: info.messageId || request.messageId,
    };
  });

const assertSelectedUidValidity = (client: ImapFlow, expected: string): void => {
  const actual = client.mailbox && client.mailbox.uidValidity.toString();
  if (!actual || actual !== expected) {
    throw Object.assign(new Error("Folder UIDVALIDITY changed"), {
      code: "UIDVALIDITY_CHANGED",
      expected,
      actual: actual || null,
    });
  }
};

const withSelectedMailbox = async <T>(
  config: ProviderConnectionInput,
  target: Pick<RemoteMutationTarget, "folderPath" | "uidValidity">,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> =>
  withImapClient(config, async (client) => {
    const lock = await client.getMailboxLock(target.folderPath, { readOnly: false });
    try {
      assertSelectedUidValidity(client, target.uidValidity);
      return await fn(client);
    } finally {
      lock.release();
    }
  });

const setFlags = async (config: ProviderConnectionInput, target: RemoteMutationTarget, flags: string[]): Promise<void> =>
  withSelectedMailbox(config, target, async (client) => {
    const changed = await client.messageFlagsSet(target.uid, flags, { uid: true });
    if (!changed) throw Object.assign(new Error("Remote message no longer exists"), { code: "REMOTE_MESSAGE_MISSING" });
  });

const mapCopyResult = (
  result: Awaited<ReturnType<ImapFlow["messageCopy"]>>,
  sourceUid: number,
  expungePending = false,
): RemoteCopyResult => ({
  destinationUidValidity: result && result.uidValidity ? result.uidValidity.toString() : null,
  destinationUid: result && result.uidMap ? (result.uidMap.get(sourceUid) ?? null) : null,
  expungePending,
});

const copy = async (config: ProviderConnectionInput, target: RemoteMutationTarget, destinationPath: string): Promise<RemoteCopyResult> =>
  withSelectedMailbox(config, target, async (client) => {
    const result = await client.messageCopy(target.uid, destinationPath, { uid: true });
    if (!result) throw Object.assign(new Error("Remote message copy failed"), { code: "REMOTE_COPY_FAILED" });
    return mapCopyResult(result, target.uid);
  });

const move = async (config: ProviderConnectionInput, target: RemoteMutationTarget, destinationPath: string): Promise<RemoteCopyResult> =>
  withSelectedMailbox(config, target, async (client) => {
    if (!capability(client, "MOVE") && !capability(client, "UIDPLUS")) {
      const copied = await client.messageCopy(target.uid, destinationPath, { uid: true });
      if (!copied) throw Object.assign(new Error("Remote message move copy failed"), { code: "REMOTE_MOVE_FAILED" });
      const marked = await client.messageFlagsAdd(target.uid, ["\\Deleted"], { uid: true });
      if (!marked) {
        throw Object.assign(new Error("Remote message was copied but the source could not be marked deleted"), {
          code: "MOVE_SOURCE_DELETE_MARK_FAILED",
        });
      }
      return mapCopyResult(copied, target.uid, true);
    }
    const result = await client.messageMove(target.uid, destinationPath, { uid: true });
    if (!result) throw Object.assign(new Error("Remote message move failed"), { code: "REMOTE_MOVE_FAILED" });
    return mapCopyResult(result, target.uid);
  });

const deleteMessage = async (config: ProviderConnectionInput, target: RemoteMutationTarget): Promise<void> =>
  withSelectedMailbox(config, target, async (client) => {
    if (!capability(client, "UIDPLUS")) {
      throw Object.assign(new Error("Safe delete requires UIDPLUS"), { code: "SAFE_DELETE_UNSUPPORTED" });
    }
    const deleted = await client.messageDelete(target.uid, { uid: true });
    if (!deleted) {
      throw Object.assign(new Error("Remote delete did not complete safely"), { code: "REMOTE_DELETE_FAILED" });
    }
  });

const appendSource = async (
  config: ProviderConnectionInput,
  folderPath: string,
  source: Buffer,
  flags: string[] = ["\\Seen"],
  internalDate = new Date(),
): Promise<RemoteAppendResult> =>
  withImapClient(config, async (client) => {
    const result = await client.append(folderPath, source, flags, internalDate);
    if (!result) throw Object.assign(new Error("Remote message append failed"), { code: "REMOTE_APPEND_FAILED" });
    return {
      uidValidity: result.uidValidity?.toString() ?? null,
      uid: result.uid ?? null,
    };
  });

const normalizeMessageId = (value: string | null | undefined): string => value?.trim().toLowerCase() ?? "";

const findMessageById = async (config: ProviderConnectionInput, folderPath: string, messageId: string): Promise<number[]> =>
  withImapClient(config, async (client) => {
    const lock = await client.getMailboxLock(folderPath, { readOnly: true });
    try {
      const matches = await client.search({ header: { "message-id": messageId } }, { uid: true });
      if (!matches || matches.length === 0) return [];
      const expected = normalizeMessageId(messageId);
      const exact: number[] = [];
      for (const uid of matches.slice(-100)) {
        const message = await client.fetchOne(uid, { uid: true, envelope: true }, { uid: true });
        if (message && normalizeMessageId(message.envelope?.messageId) === expected) exact.push(uid);
      }
      return exact.sort((left, right) => left - right);
    } finally {
      lock.release();
    }
  });

const getMessageState = async (config: ProviderConnectionInput, target: RemoteMutationTarget): Promise<RemoteMessageState> =>
  withSelectedMailbox(config, target, async (client) => {
    const message = await client.fetchOne(target.uid, { uid: true, flags: true, envelope: true }, { uid: true });
    return message
      ? {
          exists: true,
          flags: [...(message.flags ?? [])].sort(),
          messageId: message.envelope?.messageId?.trim() || null,
        }
      : { exists: false, flags: [], messageId: null };
  });

export const imapSmtpConnector: MailConnector = {
  verify,
  discoverFolders,
  getFolderStatus,
  fetchEnvelopeBatch,
  fetchFlagChanges,
  fetchUidWindow,
  downloadSourceBatch,
  send,
  sendSource,
  setFlags,
  copy,
  move,
  delete: deleteMessage,
  appendSource,
  findMessageById,
  getMessageState,
};
