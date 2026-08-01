import { latestLoopUsage, latestUsage, latestUsageSnapshot, textFromMessage } from "./chat/message-utils";

export { AiSkillsManagerBody, type AiSkillsManagerBodyProps } from "../ui/misc/AiSkillsManager";

export {
  type AiComposerAttachment,
  type AiComposerFileResult,
  type AiComposerSendInput,
  aiChatAttachments,
  aiChatModelOptions,
  aiComposerAttachmentRecords,
  aiComposerFileAccept,
  aiComposerSendInput,
  readAiComposerFiles,
} from "./chat/composer-adapter";
export type {
  AiChatActions,
  AiTurnActionRequest,
} from "./chat/message-actions";
export type {
  AiForkMessageInput,
  AiRetryMessageInput,
} from "./chat/message-utils";
export {
  AiChatActionsProvider,
  AiChatProjection,
  type AiChatProjectionProps,
  type AiChatTimelineSession,
  AiChatTurnNavigator,
  type AiChatTurnNavigatorProps,
} from "./chat/presentation";

export const aiLatestUsage = latestUsage;
export const aiLatestLoopUsage = latestLoopUsage;
export const aiLatestUsageSnapshot = latestUsageSnapshot;
export const aiMessageText = textFromMessage;
