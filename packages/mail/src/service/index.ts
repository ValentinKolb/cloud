import { createRuntimeLifecycle, stopRuntimeResources } from "@valentinkolb/cloud/services";
import * as mailboxAccess from "./access";
import * as attachmentLinks from "./attachment-links";
import * as automaticReplyConfigurations from "./automatic-reply-configuration";
import * as bindings from "./bindings";
import * as collaboration from "./collaboration";
import { commandRuntime } from "./command-runtime";
import * as commands from "./commands";
import * as composeSafety from "./compose-safety";
import * as composeTemplates from "./compose-templates";
import * as conversationContext from "./conversation-context";
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
import * as listSubscriptions from "./list-subscriptions";
import * as localTags from "./local-tags";
import * as mailboxes from "./mailboxes";
import * as hydration from "./message-hydration";
import * as messageInspector from "./message-inspector";
import * as messages from "./messages";
import * as notificationTargets from "./notification-targets";
import * as operations from "./operations";
import * as operatorActions from "./operator-actions";
import * as presence from "./presence";
import * as providerConnections from "./provider-connections";
import * as providerOAuth from "./provider-oauth";
import * as reminders from "./reminders";
import * as remoteContent from "./remote-content";
import * as savedViews from "./saved-views";
import * as scheduledSends from "./scheduled-sends";
import { cancelSendCommand } from "./scheduled-sends";
import * as search from "./search";
import * as senderIdentities from "./sender-identities";
import * as senderIdentityTransports from "./sender-identity-transports";
import * as settingsContext from "./settings-context";
import * as storageObservability from "./storage-observability";
import * as subscriptionWorkspace from "./subscription-workspace";
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
  attachmentLinks,
  automaticReplyConfigurations,
  bindings,
  cancelSendCommand,
  collaboration,
  commandRuntime,
  commands,
  composeSafety,
  composeTemplates,
  conversationContext,
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
  listSubscriptions,
  localTags,
  mailboxAccess,
  mailboxes,
  messageInspector,
  messages,
  notificationTargets,
  operations,
  presence,
  providerConnections,
  providerOAuth,
  reminders,
  remoteContent,
  savedViews,
  scheduledSends,
  search,
  senderIdentities,
  senderIdentityTransports,
  settingsContext,
  storageObservability,
  subscriptionWorkspace,
  triage,
  workflowMaterializationRuntime,
  workflowRuntime,
  workflows,
};

export const mailService = {
  access: mailboxAccess,
  automaticReplyConfigurations,
  attachmentLinks,
  bindings,
  commands,
  collaboration,
  composeSafety,
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
  listSubscriptions,
  subscriptionWorkspace,
  folders,
  hydration,
  mailboxes,
  messageInspector,
  messages,
  notificationTargets,
  operations,
  operatorActions,
  providerConnections,
  providerOAuth,
  presence,
  reminders,
  remoteContent,
  savedViews,
  scheduledSends,
  search,
  senderIdentities,
  senderIdentityTransports,
  settingsContext,
  storageObservability,
  triage,
  workflows,
  sync: {
    enqueue: enqueueMailboxSync,
  },
};
