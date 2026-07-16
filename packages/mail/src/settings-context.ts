import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type { Mailbox, MailWorkflow, ProviderBinding, ProviderConnection, SenderIdentity } from "./contracts";
import type { MailFolderView } from "./service/messages";

export type MailboxAdminSettingsContext = {
  accessEntries: AccessEntry[];
  bindings: ProviderBinding[];
  connections: ProviderConnection[];
  folders: MailFolderView[];
  identities: SenderIdentity[];
  workflows: MailWorkflow[];
};

export type MailboxSettingsContext = {
  mailbox: Mailbox;
  permission: "read" | "write" | "admin";
  admin: MailboxAdminSettingsContext | null;
};
