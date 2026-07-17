import * as mailboxAccess from "./access";
import * as bindings from "./bindings";
import * as collaboration from "./collaboration";
import { cancelSendCommand, commandRuntime } from "./command-runtime";
import * as commands from "./commands";
import * as conversations from "./conversations";
import * as conversationReferences from "./conversation-reference";
import * as draftLeases from "./draft-leases";
import * as draftUploads from "./draft-uploads";
import * as drafts from "./drafts";
import * as events from "./events";
import * as execution from "./execution";
import * as folders from "./folders";
import * as health from "./health";
import * as localTags from "./local-tags";
import * as mailboxes from "./mailboxes";
import * as hydration from "./message-hydration";
import * as messages from "./messages";
import * as notificationTargets from "./notification-targets";
import * as presence from "./presence";
import * as providerConnections from "./provider-connections";
import * as reminders from "./reminders";
import * as responseSchedules from "./response-schedule";
import * as savedViews from "./saved-views";
import * as search from "./search";
import * as senderIdentities from "./sender-identities";
import * as settingsContext from "./settings-context";
import { enqueueMailboxSync, mailRuntime } from "./sync-runtime";
import * as triage from "./triage";
import { createMailWorkflowMaterializationRuntime } from "./workflow-materialization-service";
import { enqueueWorkflowRun, workflowRuntime } from "./workflow-runtime";
import * as workflows from "./workflows";

const workflowMaterializationRuntime = createMailWorkflowMaterializationRuntime(enqueueWorkflowRun);

export type { MailRequestContext } from "./auth";
export {
  bindings,
  cancelSendCommand,
  collaboration,
  commandRuntime,
  commands,
  conversations,
  conversationReferences,
  draftLeases,
  drafts,
  draftUploads,
  enqueueMailboxSync,
  events,
  folders,
  health,
  localTags,
  mailboxAccess,
  mailboxes,
  mailRuntime,
  messages,
  notificationTargets,
  presence,
  providerConnections,
  reminders,
  responseSchedules,
  savedViews,
  search,
  senderIdentities,
  settingsContext,
  triage,
  workflowMaterializationRuntime,
  workflowRuntime,
  workflows,
};

export const mailService = {
  access: mailboxAccess,
  bindings,
  commands,
  collaboration,
  conversations,
  conversationReferences,
  draftLeases,
  draftUploads,
  drafts,
  execution,
  events,
  health,
  localTags,
  folders,
  hydration,
  mailboxes,
  messages,
  notificationTargets,
  providerConnections,
  presence,
  reminders,
  responseSchedules,
  savedViews,
  search,
  senderIdentities,
  settingsContext,
  triage,
  workflows,
  sync: {
    enqueue: enqueueMailboxSync,
  },
};
