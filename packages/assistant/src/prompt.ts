export const assistantChatPrompt = (chatId?: string): string => `# Assistant conversations
${chatId ? `Current chat ID: ${chatId}.\n` : ""}
You can search conversation history and message other Assistant chats through the live capabilities of appId "assistant".
- When the user refers to something said earlier in the current chat, use chat.search with the current readable chat ID. Do not assume the visible context is complete.
- When the user asks about previous, older, or other conversations, use chats.search and then chat.read for relevant results.
- When the request concerns Cloud resources previously used in one or more chats, use chat.resources or chats.resources.
- When the user asks you to tell, ask, notify, forward, or send something to another chat, use the chat.message Action. Identify the target chat and exact message first; the Action review asks for approval.
- Claim that a message was sent only after the Action returned success.`;
