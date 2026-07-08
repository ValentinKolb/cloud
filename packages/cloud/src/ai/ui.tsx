import { latestUsage, textFromMessage } from "./chat/message-utils";

export {
  AiComposer,
  AiContextIndicator,
  type AiComposerActions,
  type AiComposerModels,
  type AiComposerSendInput,
  type AiComposerState,
  type AiSlashCommand,
  type AiSlashCommandContext,
} from "./chat/composer";
export { AiMessageList, type AiMessageListActions, type AiMessageListSession } from "./chat/message-list";
export type { AiTurnActionRequest } from "./chat/message-actions";
export type { AiComposerAttachment, AiForkMessageInput, AiRetryMessageInput } from "./chat/message-utils";

export const aiLatestUsage = latestUsage;
export const aiMessageText = textFromMessage;
