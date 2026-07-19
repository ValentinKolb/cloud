import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type {
  ComposeSignatureDefault,
  ComposeTemplate,
  Mailbox,
  MailboxComposeStyle,
  MailboxOperationalHealth,
  MailWorkflow,
  MailWorkflowRun,
  ProviderBinding,
  ProviderConnection,
  SenderIdentity,
} from "./contracts";
import type { AutomaticReplyConfiguration } from "./service/automatic-reply-configuration";
import type { MailAssignableUser } from "./service/collaboration";
import type { ConversationReferenceScheme } from "./service/conversation-reference";
import type { LocalTag } from "./service/local-tags";
import type { MailFolderView } from "./service/messages";
import type { ResponseSchedule } from "./service/response-schedule";
import type { SavedConversationView } from "./service/saved-views";

export type MailboxAdminSettingsContext = {
  accessEntries: AccessEntry[];
  bindings: ProviderBinding[];
  connections: ProviderConnection[];
  folders: MailFolderView[];
  health: MailboxOperationalHealth;
  identities: SenderIdentity[];
  automaticReplies: AutomaticReplyConfiguration[];
  referenceSchemes: ConversationReferenceScheme[];
  responseSchedules: ResponseSchedule[];
  workflows: MailWorkflow[];
  workflowRuns: MailWorkflowRun[];
};

export type MailboxSettingsContext = {
  mailbox: Mailbox;
  permission: "read" | "write" | "admin";
  organization: {
    savedViews: SavedConversationView[];
    localTags: LocalTag[];
    folders: MailFolderView[];
    assignableUsers: MailAssignableUser[];
  };
  compose: {
    templates: ComposeTemplate[];
    defaults: ComposeSignatureDefault[];
    style: MailboxComposeStyle;
    identities: SenderIdentity[];
  } | null;
  admin: MailboxAdminSettingsContext | null;
};
