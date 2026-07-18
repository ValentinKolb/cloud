import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type {
  ComposeSignatureDefault,
  ComposeTemplate,
  Mailbox,
  MailboxComposeStyle,
  MailWorkflow,
  ProviderBinding,
  ProviderConnection,
  SenderIdentity,
} from "./contracts";
import type { AutomaticReplyConfiguration } from "./service/automatic-reply-configuration";
import type { ConversationReferenceScheme } from "./service/conversation-reference";
import type { MailFolderView } from "./service/messages";
import type { ResponseSchedule } from "./service/response-schedule";

export type MailboxAdminSettingsContext = {
  accessEntries: AccessEntry[];
  bindings: ProviderBinding[];
  connections: ProviderConnection[];
  folders: MailFolderView[];
  identities: SenderIdentity[];
  automaticReplies: AutomaticReplyConfiguration[];
  referenceSchemes: ConversationReferenceScheme[];
  responseSchedules: ResponseSchedule[];
  workflows: MailWorkflow[];
};

export type MailboxSettingsContext = {
  mailbox: Mailbox;
  permission: "read" | "write" | "admin";
  compose: {
    templates: ComposeTemplate[];
    defaults: ComposeSignatureDefault[];
    style: MailboxComposeStyle;
    identities: SenderIdentity[];
  } | null;
  admin: MailboxAdminSettingsContext | null;
};
