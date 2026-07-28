export const MAIL_CONVERSATION_TOOLBAR_ACTION_IDS = [
  "reply",
  "reply_all",
  "forward",
  "archive",
  "spam",
  "trash",
  "move",
  "read",
  "flag",
  "tags",
  "merge",
  "split",
  "print",
] as const;

export type MailConversationToolbarActionId = (typeof MAIL_CONVERSATION_TOOLBAR_ACTION_IDS)[number];
export type MailConversationToolbarSectionId = "respond" | "organize" | "mark" | "conversation" | "other";

export const MAX_MAIL_CONVERSATION_TOOLBAR_ACTIONS = 8;

export const DEFAULT_MAIL_CONVERSATION_TOOLBAR_ACTIONS: MailConversationToolbarActionId[] = [
  "reply",
  "reply_all",
  "forward",
  "archive",
  "spam",
  "trash",
];

type MailConversationToolbarActionOption = {
  id: MailConversationToolbarActionId;
  label: string;
  description: string;
  icon: string;
};

export type MailConversationToolbarSection = {
  id: MailConversationToolbarSectionId;
  label: string;
  options: readonly MailConversationToolbarActionOption[];
};

export const MAIL_CONVERSATION_TOOLBAR_SECTIONS: readonly MailConversationToolbarSection[] = [
  {
    id: "respond",
    label: "Respond",
    options: [
      { id: "reply", label: "Reply", description: "Reply to the latest message.", icon: "ti ti-arrow-back-up" },
      {
        id: "reply_all",
        label: "Reply all",
        description: "Reply to every relevant recipient.",
        icon: "ti ti-arrow-back-up-double",
      },
      { id: "forward", label: "Forward", description: "Forward the latest message.", icon: "ti ti-arrow-forward-up" },
    ],
  },
  {
    id: "organize",
    label: "Organize",
    options: [
      { id: "archive", label: "Archive", description: "Move the conversation to Archive.", icon: "ti ti-archive" },
      {
        id: "spam",
        label: "Junk / not spam",
        description: "Move to Junk, or restore from Junk when applicable.",
        icon: "ti ti-alert-octagon",
      },
      { id: "trash", label: "Delete", description: "Move the conversation to Trash.", icon: "ti ti-trash" },
      { id: "move", label: "Move to folder", description: "Choose a provider destination folder.", icon: "ti ti-folder-symlink" },
    ],
  },
  {
    id: "mark",
    label: "Mark",
    options: [
      { id: "read", label: "Read / unread", description: "Toggle the conversation's read state.", icon: "ti ti-mail-opened" },
      { id: "flag", label: "Flag / unflag", description: "Toggle the conversation's provider flag.", icon: "ti ti-flag" },
      { id: "tags", label: "Tags", description: "Choose conversation tags.", icon: "ti ti-tags" },
    ],
  },
  {
    id: "conversation",
    label: "Conversation",
    options: [
      { id: "merge", label: "Merge", description: "Merge this conversation into another.", icon: "ti ti-git-merge" },
      {
        id: "split",
        label: "Split conversation",
        description: "Move the latest message into a separate conversation.",
        icon: "ti ti-arrows-split-2",
      },
    ],
  },
  {
    id: "other",
    label: "Other",
    options: [{ id: "print", label: "Print", description: "Open the printable conversation view.", icon: "ti ti-printer" }],
  },
];

export const MAIL_CONVERSATION_TOOLBAR_ACTION_OPTIONS = MAIL_CONVERSATION_TOOLBAR_SECTIONS.flatMap((section) =>
  section.options.map((option) => ({ ...option, sectionId: section.id })),
);

export const normalizeMailConversationToolbarActions = (value: unknown): MailConversationToolbarActionId[] => {
  if (!Array.isArray(value)) return [...DEFAULT_MAIL_CONVERSATION_TOOLBAR_ACTIONS];
  const requested = new Set(value.filter((candidate): candidate is string => typeof candidate === "string"));
  return MAIL_CONVERSATION_TOOLBAR_ACTION_IDS.filter((actionId) => requested.has(actionId)).slice(0, MAX_MAIL_CONVERSATION_TOOLBAR_ACTIONS);
};
