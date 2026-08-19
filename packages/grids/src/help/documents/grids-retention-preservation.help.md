---
id: grids-retention-preservation
title: Set a Record retention floor
icon: ti ti-archive
description: Prevent future controlled destruction before trashed Records reach a technical minimum age.
order: 148
---
A retention floor is an optional technical minimum for Records in a Base's trash. It does not delete anything, schedule cleanup, decide whether destruction is appropriate, or establish legal compliance.

You need **Admin** access to the Base. Custom Apps, Workflows, API clients, and the CLI cannot bypass this permission check.

## Set the floor {icon="calendar-time"}

1. Open the Base settings and select **Retention and preservation**.
2. Enter **Minimum days in trash** between 1 and 36,500.
3. Review the live impact. It distinguishes Records still retained by the proposed floor, Records that have reached the floor, and finalized Records that remain protected independently.
4. Select **Save changes**.

Existing Bases have no retention floor by default, so their behavior does not change. The clock starts when a Record is moved to trash. Restoring and later trashing it starts a new clock from the new trash timestamp.

You can inspect and manage the same Base setting from the Cloud CLI. Use a 6-character Base ID or its exact name:

```bash
cld grids bases retention 8yMtTb --json
cld grids bases retention preview 8yMtTb --days 30 --json
cld grids bases retention set 8yMtTb --days 30 --json
```

Shortening an existing floor requires `--yes`. Removing it always requires `--yes`:

```bash
cld grids bases retention set 8yMtTb --days 14 --yes --json
cld grids bases retention remove 8yMtTb --yes --json
```

The CLI calls the same Admin-only API as Base settings. A script, Workflow, Custom App, or direct API client cannot bypass the floor or its permission check.

The preview uses one stated observation time and returns bounded examples. **Reached the floor** means only that the configured number of days has elapsed. It does not mean that Grids deleted the Record or that deletion is permitted.

## Change or remove the floor {icon="edit"}

Increasing the number preserves affected trashed Records longer. Shortening or removing it may make future controlled destruction eligible earlier, so Grids asks for confirmation. Neither action deletes anything immediately.

This first retention scope covers trashed Records only. Durable History revisions, finalized Records, immutable Documents, Number allocations, protected Files, preservation holds, and actual controlled destruction keep their separate lifecycle contracts.
