---
id: spaces-troubleshooting
title: Troubleshooting
icon: ti ti-lifebuoy
description: Fix missing spaces or items, unexpected views, assignment problems, and calendar export issues.
order: 140
---

## Common symptoms {icon="lifebuoy"}

:::reference
- **A space is missing from the overview:** Confirm that you still have read access. Spaces shared through a group can disappear when group membership changes.
- **An item is missing:** Clear search and filter chips, then check the current view. A task without a date may not appear where a calendar-only view is expected.
- **Kanban shows the wrong column:** Kanban grouping follows the selected grouping field, commonly status. Open the item and correct that field instead of moving unrelated filters.
- **An assignee cannot update work:** Read access is not enough to edit items. The person or one of their groups needs write or admin access.
- **A completed item still appears:** Check the active filters and grouping. Some views intentionally include completed work.
- **A calendar subscription is stale:** Calendar clients refresh subscriptions on their own schedule. Confirm the export URL is still enabled before replacing it.
:::

## Reset a confusing view {icon="layout-list"}

:::steps
1. Return to the space from the Spaces overview.
2. Choose List for the least transformed view of the items.
3. Clear search and filter chips.
4. Open the missing item from another known view or global search.
5. Reapply one filter at a time.
:::

:::warning Calendar links are access links
Anyone with a working calendar export URL may be able to read the exported event details. Disable or replace the export when a link has been shared too widely.
:::
