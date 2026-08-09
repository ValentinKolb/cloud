import { createRuntimeLifecycle, stopRuntimeResources } from "@valentinkolb/cloud/services";
import * as mailboxAccess from "./access";
import * as attachmentLinks from "./attachment-links";
import * as automaticReplyConfigurations from "./automatic-reply-configuration";
import * as bindings from "./bindings";
import * as calendarInvitations from "./calendar-invitations";
import * as collaboration from "./collaboration";
import { commandRuntime } from "./command-runtime";
import * as commands from "./commands";
import * as composeSafety from "./compose-safety";
import * as composeTemplates from "./compose-templates";
import * as conversationContext from "./conversation-context";
import * as conversationReferences from "./conversation-reference";
import * as conversationSummaries from "./conversation-summary";
import * as conversations from "./conversations";
import * as draftLeases from "./draft-leases";
import * as draftProviderProjection from "./draft-provider-projection";
import * as draftUploads from "./draft-uploads";
import * as drafts from "./drafts";
import * as events from "./events";
import { startMailInvalidationRuntime, stopMailInvalidationRuntime } from "./events";
import * as execution from "./execution";
import * as folders from "./folders";
import * as health from "./health";
import { imapPushRuntime } from "./imap-push-runtime";
import * as incomingAutomations from "./incoming-automations";
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
import * as security from "./security";
import * as senderIdentities from "./sender-identities";
import * as senderIdentityTransports from "./sender-identity-transports";
import * as settingsContext from "./settings-context";
import * as storageObservability from "./storage-observability";
import { enqueueMailboxSync, mailRuntime as scheduledMailRuntime } from "./sync-runtime";
import * as triage from "./triage";
import { workflowRuntime } from "./workflow-runtime";
import * as workflows from "./workflows";

const mailRuntimeLifecycle = createRuntimeLifecycle({
  start: async () => {
    await startMailInvalidationRuntime();
    await scheduledMailRuntime.start();
    await imapPushRuntime.start();
    incomingAutomations.startIncomingAutomationBackfillRuntime();
  },
  stop: () =>
    stopRuntimeResources([
      incomingAutomations.stopIncomingAutomationBackfillRuntime,
      () => imapPushRuntime.stop(),
      () => scheduledMailRuntime.stop(),
      stopMailInvalidationRuntime,
    ]),
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
  calendarInvitations,
  cancelSendCommand,
  collaboration,
  commandRuntime,
  commands,
  composeSafety,
  composeTemplates,
  conversationContext,
  conversationReferences,
  conversationSummaries,
  conversations,
  draftLeases,
  draftProviderProjection,
  drafts,
  draftUploads,
  enqueueMailboxSync,
  events,
  folders,
  health,
  incomingAutomations,
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
  security,
  senderIdentities,
  senderIdentityTransports,
  settingsContext,
  storageObservability,
  triage,
  workflowRuntime,
  workflows,
};

export const mailService = {
  access: mailboxAccess,
  automaticReplyConfigurations,
  attachmentLinks,
  bindings,
  calendarInvitations,
  commands,
  collaboration,
  composeSafety,
  composeTemplates,
  conversations,
  conversationReferences,
  conversationSummaries,
  draftLeases,
  draftProviderProjection,
  draftUploads,
  drafts,
  execution,
  events,
  health,
  incomingAutomations,
  localTags,
  listSubscriptions,
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
  security,
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
