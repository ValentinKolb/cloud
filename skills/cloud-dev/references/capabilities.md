# App capabilities

Capabilities are an app's small, versioned public automation surface. Declare
addressable resource `types`, read-only `queries`, and mutating `actions` with
ordinary closed Zod schemas. Cloud derives the live registry manifest, JSON
Schema, generic CLI commands, Universal Search providers, and MCP tools from
this one declaration.

```ts
import { defineApp, defineCapabilities } from "@valentinkolb/cloud";
import { ok } from "@k2b/stdlib";
import { Hono } from "hono";
import { z } from "zod";

const router = new Hono();

const capabilities = defineCapabilities({
  version: 1,
  types: {
    contact: {
      title: "Contact",
      description: "A person or organization in an address book.",
    },
  },
  queries: {
    get: {
      title: "Get contact",
      description: "Read one visible contact by stable id.",
      input: z
        .object({ id: z.string().uuid().describe("Stable contact id.") })
        .strict(),
      data: z.object({ id: z.string().uuid(), label: z.string() }).strict(),
      run: async ({ id }, context) => {
        // Read through the app service using context.accessSubject.
        return ok({ data: { id, label: "Example" } });
      },
    },
  },
  actions: {
    create: {
      title: "Create contact",
      description:
        "Create one contact in an address book the caller may write to.",
      input: z
        .object({
          bookId: z.string().uuid().describe("Writable address-book id."),
          label: z.string().min(1).describe("Contact display name."),
        })
        .strict(),
      data: z.object({ id: z.string().uuid() }).strict(),
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "required",
      run: async ({ bookId, label }, context) => {
        // Re-check current write access, then use context.idempotencyKey in the
        // same transaction as the effect. Return a structured service error on failure.
        const id = crypto.randomUUID();
        return ok({
          data: { id },
          refs: [{ type: "contacts.contact", id }],
          links: [{ rel: "edit", href: `/app/contacts/${bookId}` }],
        });
      },
    },
  },
});

const app = defineApp({
  id: "contacts",
  name: "Contacts",
  description: "Address books",
  icon: "ti ti-address-book",
  baseUrl: "http://app-contacts:3000",
  routes: ["/app/contacts"],
});

await app.start({ capabilities, fetch: router.fetch });
```

## Contract rules

- Use small `z.object(...).strict()` inputs. Describe every meaningful field.
- Do not use transforms or other schemas that cannot project to JSON Schema.
- Declare every resource type returned in `refs` or Universal Search views.
- Queries are read-only. Actions explicitly declare destructive, open-world,
  approval, and idempotency semantics.
- Authorize with `context.actor` and `context.accessSubject`; a Core catalog
  entry never grants access. The app authenticates and authorizes again.
- A required idempotency key must be claimed atomically with the effect. Do not
  rely on an in-memory cache or a preflight lookup.
- Return `CapabilityResult`: `data` plus optional stable `refs`, pagination,
  and root-relative semantic `links`. Return structured service errors.
- A Universal Search query must use `UniversalSearchInputSchema` and
  `UniversalSearchDataSchema`; this keeps every provider interchangeable.

The app lifecycle compiles the declaration once, rejects invalid public
schemas and manifests larger than 256 KiB at startup, and publishes the
versioned manifest in a dedicated capability registry only while the app's
lease is live. The normal app registry carries only compact search metadata.
Recurring heartbeats renew both leases without rewriting manifests. Core dispatch forwards only the caller credential,
trace context, and capability protocol headers. Generic clients must refresh
the live catalog after a schema mismatch or unavailable-app response.

The authenticated MCP endpoint is `/api/mcp/v1`. It projects live namespaced
tools and invokes the same Core dispatcher as HTTP and the CLI; it is not a
second app API.
