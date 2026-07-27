---
title: Browser clients and mutations
navTitle: Clients and mutations
section: Frontend
order: 850
description: Call typed application APIs and handle user-initiated writes consistently.
tags: [browser, api, mutations]
updated: 2026-07-27
---

# Browser clients and mutations

Call application JSON APIs through a typed Hono client.

Wrap user-initiated async work in `mutation.create()` so loading, errors,
aborts, retries, and stale results follow one contract.

## Create a typed client

Export the Hono route type from the application server:

```ts
export type InventoryApi = typeof inventoryRoutes;
```

Create the browser client in a browser-safe module:

```ts
import { api } from "@valentinkolb/cloud/browser";
import type { InventoryApi } from "../api";

export const inventoryApi = api.create<InventoryApi>({
  baseUrl: "/api/inventory",
});
```

The client infers route parameters and request payloads. Check `response.ok`
before reading success data.

Do not use raw `fetch()` for an application JSON API when its typed route is
available.

## Run a mutation

```tsx
import { mutation } from "@valentinkolb/stdlib/solid";
import { toast } from "@valentinkolb/cloud/ui";

const archive = mutation.create<void, { itemId: string }>({
  mutation: async ({ itemId }, { abortSignal }) => {
    const response = await inventoryApi.items[":id"].$delete(
      { param: { id: itemId } },
      { init: { signal: abortSignal } },
    );
    if (!response.ok) throw new Error("Item could not be archived.");
  },
  onSuccess: () => toast.success("Item archived"),
  onError: (error) => toast.error(error.message),
});
```

`mutate(vars)` starts the operation. `loading()`, `error()`, and `data()` are
reactive accessors.

`abort()` cancels the active operation. An aborted fetch calls `onAbort`, not
`onError`.

`retry()` repeats the previous variables and context. It does not run
`onBefore` again.

When a newer mutation starts, a late result from an older mutation is ignored.

## Add optimistic state carefully

`onBefore` may return context used by success, error, abort, and finally hooks.
Use it to capture the previous UI state before an optimistic change.

Restore that state on error and abort. Do not optimistically grant permission,
expose new data, or pretend an irreversible action completed.

The server remains authoritative. Reconcile the returned resource or reload
the affected server-backed view after success.

## Separate query and mutation state

Use the URL and SSR for result sets. Use a mutation for a write or a bounded
interactive fetch inside an island.

Do not turn the mutation result into a client-side cache of the application's
domain model.

See [Forms, prompts, and feedback](/docs/en/frontend/forms-prompts-and-feedback)
for presenting the operation.
