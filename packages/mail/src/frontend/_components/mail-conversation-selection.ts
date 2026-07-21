export const MAX_MAIL_CONVERSATION_SELECTION = 50;

export type MailConversationSelection = {
  ids: ReadonlySet<string>;
  anchorId: string | null;
};

export const emptyMailConversationSelection = (): MailConversationSelection => ({ ids: new Set(), anchorId: null });

export const toggleMailConversationSelection = (params: {
  selection: MailConversationSelection;
  conversationId: string;
  orderedConversationIds: readonly string[];
  range: boolean;
}): MailConversationSelection => {
  const next = new Set(params.selection.ids);
  const anchorIndex = params.selection.anchorId ? params.orderedConversationIds.indexOf(params.selection.anchorId) : -1;
  const targetIndex = params.orderedConversationIds.indexOf(params.conversationId);

  if (params.range && anchorIndex >= 0 && targetIndex >= 0) {
    const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
    for (const id of params.orderedConversationIds.slice(start, end + 1)) {
      if (next.size >= MAX_MAIL_CONVERSATION_SELECTION) break;
      next.add(id);
    }
    return { ids: next, anchorId: params.selection.anchorId };
  }

  if (next.has(params.conversationId)) next.delete(params.conversationId);
  else if (next.size < MAX_MAIL_CONVERSATION_SELECTION) next.add(params.conversationId);
  return { ids: next, anchorId: params.conversationId };
};

export const selectVisibleMailConversations = (orderedConversationIds: readonly string[]): MailConversationSelection => ({
  ids: new Set(orderedConversationIds.slice(0, MAX_MAIL_CONVERSATION_SELECTION)),
  anchorId: orderedConversationIds[0] ?? null,
});

export const pruneMailConversationSelection = (
  selection: MailConversationSelection,
  availableConversationIds: ReadonlySet<string>,
): MailConversationSelection => {
  const ids = new Set([...selection.ids].filter((id) => availableConversationIds.has(id)));
  return {
    ids,
    anchorId:
      selection.anchorId && availableConversationIds.has(selection.anchorId) ? selection.anchorId : (ids.values().next().value ?? null),
  };
};

export const findMailFocusAfterRemoval = (params: {
  orderedConversationIds: readonly string[];
  activeConversationId: string | null;
  removedConversationIds: ReadonlySet<string>;
}): string | null => {
  const activeIndex = params.activeConversationId ? params.orderedConversationIds.indexOf(params.activeConversationId) : -1;
  const start = Math.max(activeIndex, 0);
  for (let index = start + 1; index < params.orderedConversationIds.length; index += 1) {
    const id = params.orderedConversationIds[index]!;
    if (!params.removedConversationIds.has(id)) return id;
  }
  for (let index = start - 1; index >= 0; index -= 1) {
    const id = params.orderedConversationIds[index]!;
    if (!params.removedConversationIds.has(id)) return id;
  }
  return null;
};
