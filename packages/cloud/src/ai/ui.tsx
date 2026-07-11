import { latestLoopUsage, latestUsage, latestUsageSnapshot, textFromMessage } from "./chat/message-utils";

export {
  AiComposer,
  type AiComposerActions,
  type AiComposerModels,
  type AiComposerSendInput,
  type AiComposerState,
  AiContextIndicator,
  type AiSlashCommand,
  type AiSlashCommandContext,
} from "./chat/composer";
export type { AiTurnActionRequest } from "./chat/message-actions";
export { AiMessageList, type AiMessageListActions, type AiMessageListSession } from "./chat/message-list";
export type { AiComposerAttachment, AiForkMessageInput, AiRetryMessageInput } from "./chat/message-utils";

export const aiLatestUsage = latestUsage;
export const aiLatestLoopUsage = latestLoopUsage;
export const aiLatestUsageSnapshot = latestUsageSnapshot;
export const aiMessageText = textFromMessage;
