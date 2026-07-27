---
title: Universal search
navTitle: Universal search
section: Platform services
order: 560
description: Make application resources discoverable through Cloud search.
tags: [search, capabilities, authorization]
updated: 2026-07-27
---

# Universal search

Add a search capability when users should find application resources from the
shared Cloud search.

Cloud sends the query to every registered provider. The application searches
its own data and returns only results the current access subject may read.

## Define a provider

```ts
import type {
  AppSearchInput,
  AppSearchResult,
} from "@valentinkolb/cloud/contracts";

const searchInventory = async (
  input: AppSearchInput,
): Promise<AppSearchResult[]> => {
  const items = await inventory.search({
    query: input.query,
    limit: input.limit,
    accessSubject: input.accessSubject,
  });

  return items.map((item) => ({
    id: item.id,
    title: item.name,
    href: `/app/inventory/items/${item.id}`,
    preview: `${item.quantity} in stock`,
    icon: "ti ti-package",
    priority: 6,
    metadata: [{ label: "Type", value: "Inventory item" }],
  }));
};

export const inventoryCapabilities = {
  search: {
    tags: ["inventory", "stock"],
    help: "Find inventory items.",
    tagHelp: [
      { tag: "stock", help: "Show inventory items." },
    ],
    run: searchInventory,
  },
};
```

Pass the capability when the app starts:

```ts
await app.start({
  fetch: router.fetch,
  capabilities: inventoryCapabilities,
});
```

Cloud owns the internal search route and registration metadata.

## Use the input

| Field | Meaning |
| --- | --- |
| `query` | Text after search syntax has been parsed |
| `tags` | Active tag filters without the `#` prefix |
| `limit` | Maximum number of results to return |
| `user` | Signed-in Cloud user |
| `actor` | Credential that made the request |
| `accessSubject` | Principal used for resource permission checks |

Search is user-backed. Cloud does not call providers for an actor without a
user.

Always apply resource authorization with `accessSubject`. Do not return a
result and rely on its destination page to hide it later. See
[Resource authorization](/docs/en/identity/authorization).

Use `actor` only when credential provenance changes the result.

## Return results

Every result requires `id`, `title`, and a root-relative `href`. Start the path
with one `/`. Do not return an absolute URL, `//host/path`, or `/\host/path`.
Cloud rejects results that can navigate to another origin.

Optional fields add context:

- `preview` adds one short line;
- `icon` uses a Tabler icon class;
- `priority` is an integer from 0 through 9;
- `metadata` adds label-value details;
- `previewUrl` points to a root-relative preview resource and follows the same
  origin rule as `href`.

The provider owns ranking within its result set. Keep the title and preview
useful without exposing sensitive data.

Tags must have stable meanings. Declare tag help when a user would not
understand a tag from its name alone.

Provider failures do not change the application's source of truth. Log enough
context to diagnose them with [structured logging](/docs/en/platform/logging).
