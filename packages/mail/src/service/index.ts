import { createRuntimeLifecycle, stopRuntimeResources } from "@valentinkolb/cloud/services";
import * as mailboxAccess from "./access";
import * as automaticReplyConfigurations from "./automatic-reply-configuration";
import * as bindings from "./bindings";
import * as collaboration from "./collaboration";
import { commandRuntime } from "./command-runtime";
import * as commands from "./commands";
import * as composeTemplates from "./compose-templates";
import * as conversationReferences from "./conversation-reference";
import * as conversations from "./conversations";
import * as draftLeases from "./draft-leases";
import * as draftProviderProjection from "./draft-provider-projection";
import * as draftUploads from "./draft-uploads";
import * as drafts from "./drafts";
import * as events from "./events";
import * as execution from "./execution";
import * as folders from "./folders";
import * as health from "./health";
import { imapPushRuntime } from "./imap-push-runtime";
import * as localTags from "./local-tags";
import * as mailboxes from "./mailboxes";
import * as hydration from "./message-hydration";
import * as messages from "./messages";
import * as notificationTargets from "./notification-targets";
import * as presence from "./presence";
import * as providerConnections from "./provider-connections";
import * as reminders from "./reminders";
import * as savedViews from "./saved-views";
import * as scheduledSends from "./scheduled-sends";
import { cancelSendCommand } from "./scheduled-sends";
import * as search from "./search";
import * as senderIdentities from "./sender-identities";
import * as settingsContext from "./settings-context";
import { enqueueMailboxSync, mailRuntime as scheduledMailRuntime } from "./sync-runtime";
import * as triage from "./triage";
import { createMailWorkflowMaterializationRuntime } from "./workflow-materialization-service";
import { enqueueWorkflowRun, workflowRuntime } from "./workflow-runtime";
import * as workflows from "./workflows";

const workflowMaterializationRuntime = createMailWorkflowMaterializationRuntime(enqueueWorkflowRun);
const mailRuntimeLifecycle = createRuntimeLifecycle({
  start: async () => {
    await scheduledMailRuntime.start();
    await imapPushRuntime.start();
  },
  stop: () => stopRuntimeResources([() => imapPushRuntime.stop(), () => scheduledMailRuntime.stop()]),
});

export const mailRuntime = {
  start: mailRuntimeLifecycle.start,
  stop: mailRuntimeLifecycle.stop,
};

export type { MailRequestContext } from "./auth";
export {
  automaticReplyConfigurations,
  bindings,
  cancelSendCommand,
  collaboration,
  commandRuntime,
  commands,
  composeTemplates,
  conversationReferences,
  conversations,
  draftLeases,
  draftProviderProjection,
  drafts,
  draftUploads,
  enqueueMailboxSync,
  events,
  folders,
  health,
  localTags,
  mailboxAccess,
  mailboxes,
  messages,
  notificationTargets,
  presence,
  providerConnections,
  reminders,
  savedViews,
  scheduledSends,
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
  automaticReplyConfigurations,
  bindings,
  commands,
  collaboration,
  composeTemplates,
  conversations,
  conversationReferences,
  draftLeases,
  draftProviderProjection,
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
  savedViews,
  scheduledSends,
  search,
  senderIdentities,
  settingsContext,
  triage,
  workflows,
  sync: {
    enqueue: enqueueMailboxSync,
  },
};
