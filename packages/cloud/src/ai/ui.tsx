import { latestLoopUsage, latestUsage, latestUsageSnapshot, textFromMessage } from "./chat/message-utils";

export {
  aiChatAttachments,
  aiChatModelOptions,
  aiComposerAttachmentRecords,
  aiComposerFileAccept,
  aiComposerSendInput,
  type AiComposerAttachment,
  type AiComposerFileResult,
  type AiComposerSendInput,
  readAiComposerFiles,
} from "./chat/composer-adapter";
export type {
  AiChatActions,
  AiTurnActionRequest,
} from "./chat/message-actions";
export {
  AiChatActionsProvider,
  AiChatProjection,
  AiChatTurnNavigator,
  type AiChatProjectionProps,
  type AiChatTimelineSession,
  type AiChatTurnNavigatorProps,
} from "./chat/presentation";
export type {
  AiForkMessageInput,
  AiRetryMessageInput,
} from "./chat/message-utils";

export const aiLatestUsage = latestUsage;
export const aiLatestLoopUsage = latestLoopUsage;
export const aiLatestUsageSnapshot = latestUsageSnapshot;
export const aiMessageText = textFromMessage;
