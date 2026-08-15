export type MailMessageActionVisibility = {
  findSender: boolean;
  createIncomingAutomation: boolean;
  blockSender: boolean;
  manageUnsubscribe: boolean;
  conversationRepair: boolean;
  editAsNew: boolean;
};

export const resolveMailMessageActionVisibility = (input: {
  outgoing: boolean;
  hasSender: boolean;
  hasMailingListUnsubscribe: boolean;
  hasConversation: boolean;
  totalMessageCount: number;
  canWrite: boolean;
  canAdmin: boolean;
}): MailMessageActionVisibility => {
  const externalSender = input.hasSender && !input.outgoing;
  const multiMessageConversation = input.hasConversation && input.totalMessageCount > 1;
  return {
    findSender: externalSender,
    createIncomingAutomation: externalSender && input.canAdmin,
    blockSender: externalSender && input.canAdmin,
    manageUnsubscribe: externalSender && input.canWrite && input.hasMailingListUnsubscribe,
    conversationRepair: input.canWrite && multiMessageConversation,
    editAsNew: input.canWrite,
  };
};
