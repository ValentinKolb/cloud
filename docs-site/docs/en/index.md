---
title: Developer documentation
navTitle: Introduction
section: Start
order: 10
description: Understand the Cloud application model and choose the platform building blocks your service needs.
tags: [cloud, platform, applications]
updated: 2026-07-26
---

# Developer documentation

Cloud is an open-source application platform that runs on your infrastructure. It supplies shared capabilities around independent services: identity, permissions, interface foundations, data services, background work, notifications, and operations.

## Start with the application model

An application owns its domain, routes, data model, deployment, and release cycle. Cloud connects it to the rest of the platform through a small application contract.

[Read the platform overview](/docs/en/overview)

## What this documentation will cover

| Start here | What it answers |
| --- | --- |
| [Platform overview](/docs/en/overview) | Where an application ends and the platform begins |
| [Platform APIs](/docs/en/platform) | Which shared capability to use from application code |
| [Settings](/docs/en/platform/settings) | How an app declares, reads, and changes runtime configuration |
| [Logging](/docs/en/platform/logging) | How an app writes structured operational events |
| [Notifications](/docs/en/platform/notifications) | How an app defines and sends typed user or email notifications |

The [UI catalog](/ui) renders components directly from the shared Cloud
package. Additional guides will cover identity, data, jobs, schedules, queues,
durable workflows, and operations without mixing those concerns into the
application foundation.
