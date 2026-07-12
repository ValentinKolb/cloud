import type { Readable } from "node:stream";
import type { ConnectorVerification, ProviderConnectionInput, RemoteFolder, RemoteMessageRef } from "../../contracts";

export type ConnectorAddress = {
  name: string | null;
  address: string;
};

export type ConnectorEnvelope = {
  remoteRef: RemoteMessageRef;
  providerMessageId: string | null;
  providerThreadId: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  sentAt: Date | null;
  internalDate: Date;
  sizeBytes: number;
  flags: string[];
  labels: string[];
  addresses: {
    from: ConnectorAddress[];
    replyTo: ConnectorAddress[];
    to: ConnectorAddress[];
    cc: ConnectorAddress[];
    bcc: ConnectorAddress[];
  };
  mimeStructure: Record<string, unknown>;
};

export type EnvelopeBatchRequest = {
  folderPath: string;
  folderStableKey: string;
  uidValidity: string;
  highUid: number;
  lowUid?: number;
  limit: number;
};

export type EnvelopeBatch = {
  messages: ConnectorEnvelope[];
  nextHighUid: number | null;
};

export type SourceDownloadRequest = {
  key: string;
  uidValidity: string;
  uid: number;
};

export type SourceDownload = SourceDownloadRequest & {
  expectedSize: number;
  stream: Readable;
};

export type FolderStatusSnapshot = {
  uidValidity: string;
  uidNext: number;
  highestModseq: string | null;
  messages: number;
};

export type FlagChange = {
  uid: number;
  modseq: string | null;
  flags: string[];
  labels: string[];
};

export type SendRequest = {
  from: { name?: string | null; address: string };
  replyTo?: string | null;
  envelopeFrom?: string | null;
  to: Array<{ name?: string | null; address: string }>;
  cc?: Array<{ name?: string | null; address: string }>;
  bcc?: Array<{ name?: string | null; address: string }>;
  subject: string;
  text: string;
  html?: string | null;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
};

export type SendResult = {
  accepted: string[];
  rejected: string[];
  response: string;
  messageId: string;
};

export type RemoteMutationTarget = {
  folderPath: string;
  uidValidity: string;
  uid: number;
};

export type RemoteCopyResult = {
  destinationUidValidity: string | null;
  destinationUid: number | null;
  expungePending: boolean;
};

export type RemoteAppendResult = {
  uidValidity: string | null;
  uid: number | null;
};

export type RemoteMessageState = {
  exists: boolean;
  flags: string[];
  keywords: string[];
  messageId: string | null;
};

export type RemoteMessageStateChange = {
  addFlags: string[];
  removeFlags: string[];
  addKeywords: string[];
  removeKeywords: string[];
};

export type SendSourceRequest = {
  source: Readable;
  envelopeFrom: string;
  recipients: string[];
  messageId: string;
};

export interface MailConnector {
  verify(config: ProviderConnectionInput): Promise<ConnectorVerification>;
  discoverFolders(config: ProviderConnectionInput, rootPath?: string | null): Promise<RemoteFolder[]>;
  getFolderStatus(config: ProviderConnectionInput, folderPath: string): Promise<FolderStatusSnapshot>;
  fetchEnvelopeBatch(config: ProviderConnectionInput, request: EnvelopeBatchRequest): Promise<EnvelopeBatch>;
  fetchFlagChanges(
    config: ProviderConnectionInput,
    folderPath: string,
    sinceModseq: string,
    lowUid: number,
    highUid: number,
  ): Promise<FlagChange[]>;
  fetchUidWindow(config: ProviderConnectionInput, folderPath: string, lowUid: number, highUid: number): Promise<number[]>;
  downloadSourceBatch(
    config: ProviderConnectionInput,
    folderPath: string,
    requests: SourceDownloadRequest[],
    consume: (source: SourceDownload) => Promise<void>,
  ): Promise<void>;
  send(config: ProviderConnectionInput, request: SendRequest): Promise<SendResult>;
  sendSource(config: ProviderConnectionInput, request: SendSourceRequest): Promise<SendResult>;
  setFlags(config: ProviderConnectionInput, target: RemoteMutationTarget, flags: string[]): Promise<void>;
  changeMessageState(
    config: ProviderConnectionInput,
    target: RemoteMutationTarget,
    change: RemoteMessageStateChange,
  ): Promise<RemoteMessageState>;
  copy(config: ProviderConnectionInput, target: RemoteMutationTarget, destinationPath: string): Promise<RemoteCopyResult>;
  move(config: ProviderConnectionInput, target: RemoteMutationTarget, destinationPath: string): Promise<RemoteCopyResult>;
  delete(config: ProviderConnectionInput, target: RemoteMutationTarget): Promise<void>;
  appendSource(
    config: ProviderConnectionInput,
    folderPath: string,
    source: Readable,
    byteLength: number,
    flags?: string[],
    internalDate?: Date,
  ): Promise<RemoteAppendResult>;
  findMessageById(config: ProviderConnectionInput, folderPath: string, messageId: string): Promise<number[]>;
  getMessageState(config: ProviderConnectionInput, target: RemoteMutationTarget): Promise<RemoteMessageState>;
  createFolder(config: ProviderConnectionInput, path: string, subscribe: boolean): Promise<void>;
  renameFolder(config: ProviderConnectionInput, path: string, newPath: string): Promise<void>;
  deleteFolder(config: ProviderConnectionInput, path: string): Promise<void>;
  setFolderSubscription(config: ProviderConnectionInput, path: string, subscribed: boolean): Promise<void>;
}
