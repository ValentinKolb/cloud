---
id: assistant-workflow
title: Chats & Actions
icon: ti ti-messages
description: Find chats, manage metadata, retry, fork, compact, stop, and handle actions.
order: 110
---

Assistant separates Project chats from general chats in the sidebar. Expand a Project to open its ten most recently active chats, or select the Project itself to search its complete chat history.

## Chat navigation {icon="layout-list"}

:::reference
- **Projects:** Expand a Project for its recent private chats. Selecting the Project opens its instructions, context, and server-backed chat search.
- **General chats:** Chats without a Project remain grouped by recent activity below Projects.
- **Search chats:** Use the sidebar search button or the platform shortcut to search saved chats.
- **All Chats:** Open All Chats for paginated chat history, server-side search, and edit actions.
- **Chat context:** Open the floating context button for Sources, files, scheduled tasks, and the readable chat ID. On small screens the same content opens as a dialog.
- **Sources:** Sources combine attached inputs, consulted web pages, structured Cloud resources, and bounded source activity. Use View all for the complete list.
- **Edit or archive:** Use the settings action on a chat to change its name, icon, description, pinning, or archive it.
:::

## Message actions {icon="point"}

:::reference
- **Stop:** Stop aborts the running assistant turn for the open chat.
- **Retry:** Retry reruns a user message and replaces later messages in that chat branch.
- **Fork:** Fork creates a new chat copied through the selected message.
- **Compact:** Use the `/compact` command to summarize the current chat context before continuing.
- **Projects:** Project settings expose shared instructions and context according to your read, write, or admin permission. Project chats remain private.
:::

:::info Approvals and client actions
Some turns can request an approval or a frontend tool result. Answer those prompts in the message list to let the turn continue. Bounded, repeatable Actions may offer **Always approve** in the approval button menu; deletion, external effects, and other consequential Actions continue to ask every time.
:::

## Conversation-aware Assistant {icon="message-forward"}

Assistant can use its live capabilities when your request depends on chat
history. It can search the current chat, find and read another owned chat, and
find structured Cloud resources previously used in either scope.

If you explicitly ask Assistant to tell, ask, notify, forward, or send exact
text to another chat, it can request the `chat.message` Action. The approval
prompt shows the target and exact text before anything is queued. Delivered
messages appear in the target history with their source chat; they are not
shown as messages authored by you.
