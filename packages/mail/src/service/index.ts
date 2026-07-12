import * as mailboxAccess from "./access";
import * as bindings from "./bindings";
import { cancelSendCommand, commandRuntime } from "./command-runtime";
import * as commands from "./commands";
import * as drafts from "./drafts";
import * as execution from "./execution";
import * as mailboxes from "./mailboxes";
import * as hydration from "./message-hydration";
import * as messages from "./messages";
import * as providerConnections from "./provider-connections";
import * as search from "./search";
import * as senderIdentities from "./sender-identities";
import { enqueueMailboxSync, mailRuntime } from "./sync-runtime";

export type { MailRequestContext } from "./auth";
export {
  bindings,
  cancelSendCommand,
  commandRuntime,
  commands,
  drafts,
  enqueueMailboxSync,
  mailboxAccess,
  mailboxes,
  mailRuntime,
  messages,
  providerConnections,
  search,
  senderIdentities,
};

export const mailService = {
  access: mailboxAccess,
  bindings,
  commands,
  drafts,
  execution,
  hydration,
  mailboxes,
  messages,
  providerConnections,
  search,
  senderIdentities,
  sync: {
    enqueue: enqueueMailboxSync,
  },
};
