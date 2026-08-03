import { ChatComposer } from "./ChatComposer";
import { ChatActivity, ChatContextUsage, ChatMessage } from "./ChatPrimitives";
import { ChatRoot } from "./ChatRoot";
import { ChatTimeline } from "./ChatTimeline";

export type { ChatCommand, ChatCommandContext, ChatComposerProps, ChatFileSelection } from "./ChatComposer";
export type { ChatActivityProps, ChatContextUsageProps, ChatMessageProps } from "./ChatPrimitives";
export type { ChatActivityItem, ChatMessageItem, ChatTimelineItem, ChatTimelineProps } from "./ChatTimeline";
export type {
  ChatAction,
  ChatActivityTone,
  ChatAttachment,
  ChatComposerState,
  ChatContextUsageData,
  ChatMessageStatus,
  ChatModelOption,
  ChatRole,
  ChatSubmitInput,
  ChatSubmitIntent,
  ChatUsage,
} from "./types";
export { formatChatTokens } from "./ChatPrimitives";

export type { ChatRootProps } from "./ChatRoot";

/**
 * Portable, controlled chat surface. Applications own storage, streaming,
 * authorization, rich message rendering, and domain actions.
 */
export const Chat = Object.assign(ChatRoot, {
  Timeline: ChatTimeline,
  Message: ChatMessage,
  Activity: ChatActivity,
  Composer: ChatComposer,
  ContextUsage: ChatContextUsage,
});
