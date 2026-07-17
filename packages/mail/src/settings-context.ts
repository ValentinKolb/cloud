import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type { Mailbox, MailWorkflow, ProviderBinding, ProviderConnection, SenderIdentity } from "./contracts";
import type { ConversationReferenceScheme } from "./service/conversation-reference";
import type { MailFolderView } from "./service/messages";
import type { ResponseSchedule } from "./service/response-schedule";

export type MailboxAdminSettingsContext = {
  accessEntries: AccessEntry[];
  bindings: ProviderBinding[];
  connections: ProviderConnection[];
  folders: MailFolderView[];
  identities: SenderIdentity[];
  referenceSchemes: ConversationReferenceScheme[];
  responseSchedules: ResponseSchedule[];
  workflows: MailWorkflow[];
};

export type MailboxSettingsContext = {
  mailbox: Mailbox;
  permission: "read" | "write" | "admin";
  admin: MailboxAdminSettingsContext | null;
};
