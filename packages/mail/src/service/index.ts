import * as mailboxAccess from "./access";
import * as bindings from "./bindings";
import { cancelSendCommand, commandRuntime } from "./command-runtime";
import * as commands from "./commands";
import * as collaboration from "./collaboration";
import * as drafts from "./drafts";
import * as execution from "./execution";
import * as events from "./events";
import * as health from "./health";
import * as folders from "./folders";
import * as mailboxes from "./mailboxes";
import * as hydration from "./message-hydration";
import * as messages from "./messages";
import * as providerConnections from "./provider-connections";
import * as search from "./search";
import * as senderIdentities from "./sender-identities";
import * as triage from "./triage";
import { enqueueMailboxSync, mailRuntime } from "./sync-runtime";
import { workflowRuntime } from "./workflow-runtime";
import * as workflows from "./workflows";

export type { MailRequestContext } from "./auth";
export {
  bindings,
  cancelSendCommand,
  commandRuntime,
  commands,
  collaboration,
  drafts,
  enqueueMailboxSync,
  events,
  health,
  folders,
  mailboxAccess,
  mailboxes,
  mailRuntime,
  messages,
  providerConnections,
  search,
  senderIdentities,
  triage,
  workflowRuntime,
  workflows,
};

export const mailService = {
  access: mailboxAccess,
  bindings,
  commands,
  collaboration,
  drafts,
  execution,
  events,
  health,
  folders,
  hydration,
  mailboxes,
  messages,
  providerConnections,
  search,
  senderIdentities,
  triage,
  workflows,
  sync: {
    enqueue: enqueueMailboxSync,
  },
};
