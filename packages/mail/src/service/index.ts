import * as mailboxAccess from "./access";
import * as bindings from "./bindings";
import * as collaboration from "./collaboration";
import { cancelSendCommand, commandRuntime } from "./command-runtime";
import * as commands from "./commands";
import * as conversations from "./conversations";
import * as drafts from "./drafts";
import * as events from "./events";
import * as execution from "./execution";
import * as folders from "./folders";
import * as health from "./health";
import * as mailboxes from "./mailboxes";
import * as hydration from "./message-hydration";
import * as messages from "./messages";
import * as notificationTargets from "./notification-targets";
import * as presence from "./presence";
import * as providerConnections from "./provider-connections";
import * as reminders from "./reminders";
import * as savedViews from "./saved-views";
import * as search from "./search";
import * as senderIdentities from "./sender-identities";
import { enqueueMailboxSync, mailRuntime } from "./sync-runtime";
import * as triage from "./triage";
import { workflowRuntime } from "./workflow-runtime";
import * as workflows from "./workflows";

export type { MailRequestContext } from "./auth";
export {
  bindings,
  cancelSendCommand,
  collaboration,
  commandRuntime,
  commands,
  conversations,
  drafts,
  enqueueMailboxSync,
  events,
  folders,
  health,
  mailboxAccess,
  mailboxes,
  mailRuntime,
  messages,
  notificationTargets,
  presence,
  providerConnections,
  reminders,
  savedViews,
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
  conversations,
  drafts,
  execution,
  events,
  health,
  folders,
  hydration,
  mailboxes,
  messages,
  notificationTargets,
  providerConnections,
  presence,
  reminders,
  savedViews,
  search,
  senderIdentities,
  triage,
  workflows,
  sync: {
    enqueue: enqueueMailboxSync,
  },
};
