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
| Locks, rate limits, queues, topics, and short-lived cache entries | Valkey through `@valentinkolb/sync` or a bounded cache |
| Large files or shared file trees | External storage, with ownership metadata in Postgres |

Postgres is the default for state that must survive a restart.

Valkey coordinates work. Durable domain records stay in Postgres.

## Own one schema

Create a schema only when the application stores data:

```sql
CREATE SCHEMA IF NOT EXISTS inventory;
```

Use that schema for the application's tables, indexes, and constraints.

An application may reference platform tables:

```sql
owner_id UUID NOT NULL
  REFERENCES auth.users(id) ON DELETE CASCADE
```

It must not create, alter, or delete objects in platform schemas.

Platform-owned schemas include:

- `auth`
- `settings`
- `notifications`
- `logging`
- `audit`

See [Resource authorization](/docs/en/identity/authorization) before linking
domain resources to `auth.access`.

## Keep services stateless

Several instances of one application can run at the same time.

Do not keep durable state in module variables, local files, or one container's
memory. Another request may reach another instance, and a restart removes that
state.

Use memory only for values that can be rebuilt safely.

## Continue by task

- [Postgres queries](/docs/en/data/postgres-queries) covers Bun SQL, row
  mapping, filters, arrays, and safe ordering.
- [Migrations and transactions](/docs/en/data/migrations-and-transactions)
  covers idempotent schema changes, atomic writes, and large staged changes.
- [Secrets and persistent state](/docs/en/data/secrets-and-persistent-state)
  explains settings, encrypted tables, Valkey, and external storage.

Read [Services and Result](/docs/en/server/services-and-results) before
building the application service around these stores.
