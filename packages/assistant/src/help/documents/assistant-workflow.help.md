---
id: assistant-workflow
title: Chats & Actions
icon: ti ti-messages
description: Find chats, manage metadata, retry, fork, compact, stop, and handle actions.
order: 110
---

Assistant keeps recent chats in the sidebar and stores older chats on the All Chats page. Search is the fastest way back to a known conversation.

## Chat navigation {icon="layout-list"}

:::reference
- **Recent groups:** The sidebar groups recent chats into Today, This Week, and This Month.
- **Search chats:** Use the sidebar search button or the platform shortcut to search saved chats.
- **All Chats:** Open All Chats for paginated chat history, server-side search, and edit actions.
- **Edit or delete:** Use the settings action on a chat to change its name, icon, description, or delete it.
:::

## Message actions {icon="point"}

:::reference
- **Stop:** Stop aborts the running assistant turn for the open chat.
- **Retry:** Retry reruns a user message and replaces later messages in that chat branch.
- **Fork:** Fork creates a new chat copied through the selected message.
- **Compact:** Use the `/compact` command to summarize the current chat context before continuing.
:::

:::info Approvals and client actions
Some turns can request an approval or a frontend tool result. Answer those prompts in the message list to let the turn continue.
:::
