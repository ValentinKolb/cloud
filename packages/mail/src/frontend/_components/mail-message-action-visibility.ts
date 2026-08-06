export type MailMessageActionVisibility = {
  findSender: boolean;
  createIncomingAutomation: boolean;
  markSenderRead: boolean;
  blockSender: boolean;
  manageUnsubscribe: boolean;
  providerKeywords: boolean;
  conversationKeyword: boolean;
  conversationRepair: boolean;
  editAsNew: boolean;
  resend: boolean;
};

export const resolveMailMessageActionVisibility = (input: {
  outgoing: boolean;
  hasSender: boolean;
  hasMailingListUnsubscribe: boolean;
  hasProviderPlacement: boolean;
  hasConversation: boolean;
  hasConversationSourceFolder: boolean;
  totalMessageCount: number;
  canWrite: boolean;
  canAdmin: boolean;
}): MailMessageActionVisibility => {
  const externalSender = input.hasSender && !input.outgoing;
  const multiMessageConversation = input.hasConversation && input.totalMessageCount > 1;
  return {
    findSender: externalSender,
    createIncomingAutomation: externalSender && input.canAdmin,
    markSenderRead: externalSender && input.canWrite,
    blockSender: externalSender && input.canAdmin,
    manageUnsubscribe: externalSender && input.canWrite && input.hasMailingListUnsubscribe,
    providerKeywords: input.canWrite && input.hasProviderPlacement,
    conversationKeyword: input.canWrite && multiMessageConversation && input.hasConversationSourceFolder,
    conversationRepair: input.canWrite && multiMessageConversation,
    editAsNew: input.canWrite,
    resend: input.canWrite && input.outgoing,
  };
};
