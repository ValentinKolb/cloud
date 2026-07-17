---
id: faq-start
title: Start
icon: ti ti-help-circle
description: Public FAQ entries, audiences, Markdown answers, and admin maintenance.
order: 100
---

FAQ publishes short help entries at `/faq` and lets admins maintain the questions, answers, and audiences behind them.

## Overview

- **Entry:** One question with one Markdown answer.
- **Audience:** Entries can target logged-out visitors, guest accounts, full users, or a combination of those groups.
- **Public page:** `/faq` shows only entries whose audience matches the current visitor.
- **Admin page:** `/admin/faq` is admin-only and lists every entry with create, edit, and delete actions.

## Admin workflow

- **Create an entry:** Use New Entry, write the question and Markdown answer, then pick at least one audience.
- **Edit safely:** Editing keeps the entry in place and updates only the question, answer, or audiences you save.
- **Delete old content:** Delete removes the entry from both the admin list and the public FAQ.

:::info Audience filtering
Logged-out visitors see anonymous entries. Guest and full-user accounts see entries for their own audience.
:::
