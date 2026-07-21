import type { ConversationTriageInput } from "../../contracts";

export const MAIL_TRIAGE_COMMAND_IDS = ["mark_read", "mark_unread", "flag", "unflag", "archive", "junk", "trash", "move"] as const;

const MAIL_NAVIGATION_COMMAND_IDS = ["next", "previous", "clear_selection", "command_palette", "configure_shortcuts"] as const;

export type MailTriageCommandId = (typeof MAIL_TRIAGE_COMMAND_IDS)[number];
export type MailNavigationCommandId = (typeof MAIL_NAVIGATION_COMMAND_IDS)[number];
export type MailProductivityCommandId = MailTriageCommandId | MailNavigationCommandId;

export type MailCommandDescriptor = {
  id: MailProductivityCommandId;
  label: string;
  description: string;
  icon: string;
  defaultShortcut: string | null;
  scope: "conversation" | "navigation" | "workspace";
  destructive?: boolean;
};

const COMMANDS = [
  {
    id: "archive",
    label: "Archive",
    description: "Move the selected conversations to the configured Archive folder.",
    icon: "ti ti-archive",
    defaultShortcut: "e",
    scope: "conversation",
  },
  {
    id: "junk",
    label: "Move to junk",
    description: "Move the selected conversations to the configured Junk folder.",
    icon: "ti ti-alert-octagon",
    defaultShortcut: "shift+j",
    scope: "conversation",
  },
  {
    id: "trash",
    label: "Delete",
    description: "Move the selected conversations to the configured Trash folder.",
    icon: "ti ti-trash",
    defaultShortcut: "delete",
    scope: "conversation",
    destructive: true,
  },
  {
    id: "mark_read",
    label: "Mark as read",
    description: "Mark the selected conversations as read in their current provider folders.",
    icon: "ti ti-mail-opened",
    defaultShortcut: "shift+i",
    scope: "conversation",
  },
  {
    id: "mark_unread",
    label: "Mark as unread",
    description: "Mark the selected conversations as unread in their current provider folders.",
    icon: "ti ti-mail",
    defaultShortcut: "shift+u",
    scope: "conversation",
  },
  {
    id: "flag",
    label: "Flag",
    description: "Flag the selected conversations in their current provider folders.",
    icon: "ti ti-flag",
    defaultShortcut: "f",
    scope: "conversation",
  },
  {
    id: "unflag",
    label: "Remove flag",
    description: "Remove flags from the selected conversations in their current provider folders.",
    icon: "ti ti-flag-off",
    defaultShortcut: "shift+f",
    scope: "conversation",
  },
  {
    id: "move",
    label: "Move to folder",
    description: "Choose a provider folder for the selected conversations.",
    icon: "ti ti-folder-symlink",
    defaultShortcut: "v",
    scope: "conversation",
  },
  {
    id: "next",
    label: "Next conversation",
    description: "Open the next conversation in the current list.",
    icon: "ti ti-chevron-down",
    defaultShortcut: "j",
    scope: "navigation",
  },
  {
    id: "previous",
    label: "Previous conversation",
    description: "Open the previous conversation in the current list.",
    icon: "ti ti-chevron-up",
    defaultShortcut: "k",
    scope: "navigation",
  },
  {
    id: "clear_selection",
    label: "Clear conversation selection",
    description: "Clear the current multi-conversation selection.",
    icon: "ti ti-square-x",
    defaultShortcut: "esc",
    scope: "navigation",
  },
  {
    id: "command_palette",
    label: "Mail commands",
    description: "Search the commands available in this mailbox.",
    icon: "ti ti-command",
    defaultShortcut: "mod+shift+p",
    scope: "workspace",
  },
  {
    id: "configure_shortcuts",
    label: "Configure keyboard shortcuts",
    description: "Change or disable Mail keyboard shortcuts on this device.",
    icon: "ti ti-keyboard",
    defaultShortcut: null,
    scope: "workspace",
  },
] as const satisfies readonly MailCommandDescriptor[];

export const MAIL_COMMANDS: readonly MailCommandDescriptor[] = COMMANDS;

const commandById = new Map<MailProductivityCommandId, MailCommandDescriptor>(COMMANDS.map((command) => [command.id, command]));

export const getMailCommand = (id: MailProductivityCommandId): MailCommandDescriptor => {
  const command = commandById.get(id);
  if (!command) throw new Error(`Unknown Mail command: ${id}`);
  return command;
};

export const isMailTriageCommand = (id: MailProductivityCommandId): id is MailTriageCommandId =>
  (MAIL_TRIAGE_COMMAND_IDS as readonly string[]).includes(id);

export const buildMailTriageInput = (params: {
  commandId: MailTriageCommandId;
  sourceFolderId: string;
  destinationFolderId?: string;
  idempotencyKey: string;
  correlationId: string;
}): ConversationTriageInput => {
  if (params.commandId === "move") {
    if (!params.destinationFolderId) throw new Error("Choose a destination folder before moving conversations.");
    return {
      kind: "move_to_folder",
      sourceFolderId: params.sourceFolderId,
      destinationFolderId: params.destinationFolderId,
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId,
    };
  }
  if (params.commandId === "archive" || params.commandId === "junk" || params.commandId === "trash") {
    return {
      kind: "move_to_role",
      sourceFolderId: params.sourceFolderId,
      role: params.commandId,
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId,
    };
  }
  return {
    kind: "change_state",
    sourceFolderId: params.sourceFolderId,
    change: {
      addFlags: params.commandId === "mark_read" ? ["seen"] : params.commandId === "flag" ? ["flagged"] : [],
      removeFlags: params.commandId === "mark_unread" ? ["seen"] : params.commandId === "unflag" ? ["flagged"] : [],
      addKeywords: [],
      removeKeywords: [],
    },
    idempotencyKey: params.idempotencyKey,
    correlationId: params.correlationId,
  };
};
