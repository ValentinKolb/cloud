import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type {
  ComposeSignatureDefault,
  ComposeTemplate,
  Mailbox,
  MailboxComposeStyle,
  MailboxOperationalHealth,
  ProviderBinding,
  ProviderConnection,
  SenderIdentity,
} from "./contracts";
import type { MailAssignableUser } from "./service/collaboration";
import type { LocalTag } from "./service/local-tags";
import type { MailFolderView } from "./service/messages";
import type { SavedConversationView } from "./service/saved-views";

export type MailboxAdminSettingsContext = {
  accessEntries: AccessEntry[];
  bindings: ProviderBinding[];
  connections: ProviderConnection[];
  folders: MailFolderView[];
  health: MailboxOperationalHealth;
  identities: SenderIdentity[];
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
