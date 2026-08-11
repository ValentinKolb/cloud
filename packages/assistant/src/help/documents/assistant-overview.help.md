---
id: assistant-overview
title: Overview
icon: ti ti-sparkles
description: Chats, models, turns, and the first useful workflow.
order: 100
---

Assistant is a personal AI workspace for writing, rewriting, summarizing, explaining, planning, and working with supported files. Chats are saved to your user account and are already available from the Assistant overview.

## Overview {icon="layout-grid"}

:::reference
- **Chat:** One conversation owned by your user account. Chats appear in the sidebar and on the All Chats page.
- **Model:** A selectable AI model profile with streaming support. The composer uses the default model unless you choose another one.
- **Turn:** One assistant run for a user message. Running turns can stream, reconnect, ask for actions, or be stopped.
- **Chat metadata:** Each chat has a name, icon, and optional description that you can edit from the sidebar or All Chats list.
:::

## First useful path {icon="route"}

:::reference
- **Start a chat:** Use New Chat or type a message in an empty Assistant view.
- **Return to existing work:** Use the recent chat groups, Search Chats, or All Chats without opening a conversation first.
- **Choose a model when needed:** Pick a model in the composer when more than one selectable streaming model is available.
- **Send the request:** Write the task clearly, attach files if the composer offers attachments, then send.
- **Keep the useful thread:** Rename the chat or add a description when the conversation should be easy to find later.
- **Search inside a chat:** Use `/search` to find visible messages or inspect the structured Cloud resources used in this chat or across your active chats.
- **Schedule future work:** Ask Assistant to continue a chat once at a specific local date and time or on a recurring schedule. Assistant shows an Action review before creating or changing the task.
:::

## Scheduled chat tasks {icon="clock"}

Scheduled tasks deliver a saved prompt back into one chat. If that chat belongs to a Project, the run uses the Project access, instructions, files, knowledge, references, and model default that are current when it starts.

One-time schedules use an exact local time in the Cloud application timezone. Recurring schedules use a five-field cron expression in that same timezone. Ask Assistant to list or read existing tasks, or manage them from the CLI with `cld assistant tasks`. Failed tasks move to **needs attention** and notify you. Deleting a chat also deletes its scheduled tasks and run history.

Open Chat context and choose **View all** under Scheduled to create, edit, pause, resume, run, delete, or inspect the occurrence history of that chat's tasks.

:::info When Assistant is unavailable
If AI is disabled, misconfigured, or has no selectable streaming model, the composer is disabled and the page shows the current status error.
:::
