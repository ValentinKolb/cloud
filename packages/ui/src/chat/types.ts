export type ChatRole = "user" | "assistant" | "system" | "tool";

export type ChatMessageStatus = "pending" | "streaming" | "complete" | "error";

export type ChatActivityTone = "neutral" | "ai" | "success" | "danger";

export type ChatAction = {
  id: string;
  label: string;
  icon?: string;
  variant?: "danger";
  disabled?: boolean;
  onSelect?: () => void | Promise<void>;
  copyText?: string;
};

export type ChatAttachment = {
  id: string;
  name: string;
  size?: number;
  kind?: "file" | "image";
  icon?: string;
  previewUrl?: string;
  alt?: string;
  /** Opaque application-owned payload returned unchanged with ChatSubmitInput. */
  data?: unknown;
};

export type ChatUsage = {
  input?: number;
  output?: number;
  total?: number;
};

export type ChatContextUsageData = {
  usage?: ChatUsage | null;
  loopUsage?: ChatUsage | null;
  contextWindow?: number;
  modelLabel?: string;
};

export type ChatModelOption = {
  id: string;
  label: string;
  description?: string;
  image?: string;
  icon?: string;
  capabilities?: readonly string[];
};

export type ChatComposerState = "idle" | "submitting" | "running" | "stopping";

export type ChatSubmitIntent = "send" | "steer";

export type ChatSubmitInput = {
  intent: ChatSubmitIntent;
  text: string;
  attachments: readonly ChatAttachment[];
};
