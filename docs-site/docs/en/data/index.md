---
title: Data ownership
navTitle: Overview
section: Data
order: 400
description: Decide which data belongs to an application and which data belongs to the platform.
tags: [data, postgres, settings, storage]
updated: 2026-07-27
---

# Data ownership

An application owns its domain data.

Most applications store that data in one Postgres schema named after the
application. Cloud owns shared platform data such as accounts, access entries,
settings, notifications, and logs.

## Choose the store

| Data | Store |
| --- | --- |
| Domain records and relationships | Application-owned Postgres schema |
| Operator-controlled runtime configuration | Cloud settings |
| One fixed credential for a setting | A `secret` setting |
| Credentials created for users or resources | Encrypted application table |
| Locks, rate limits, queues, topics, and short-lived cache entries | Valkey through `@k2b/sync` or a bounded cache |
| Large files or shared file trees | External storage, with ownership metadata in Postgres |

Postgres is the default for state that must survive a restart.

Valkey coordinates work. Durable domain records stay in Postgres.

## Continue by task

| Task | Page |
| --- | --- |
| Query an application-owned schema | [Postgres queries](/en/docs/data/postgres-queries) |
| Change the schema or write atomically | [Migrations and transactions](/en/docs/data/migrations-and-transactions) |
| Place secrets, cache entries, files, and other state | [Secrets and persistent state](/en/docs/data/secrets-and-persistent-state) |
| Link domain resources to platform access | [Resource authorization](/en/docs/identity/authorization) |
| Wrap persistence in domain behavior | [Services and Result](/en/docs/server/services-and-results) |
