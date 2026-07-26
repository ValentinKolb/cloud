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

| Area | What you will find here |
| --- | --- |
| Applications | `defineApp()`, lifecycle, routes, configuration, and service discovery |
| Identity and access | Sessions, actors, service identities, roles, and resource permissions |
| Interface | SSR shells, navigation, settings, search, administration, and shared components |
| Data and automation | App-owned persistence, jobs, schedules, queues, and durable workflows |
| Communication | Notifications, email, Web Push, and application events |
| Operations | Logging, tracing, health, metrics, graceful shutdown, and scaling |

The first detailed reference is the [platform overview](/docs/en/overview). The [UI catalog](/ui) already renders components directly from the shared Cloud package.
