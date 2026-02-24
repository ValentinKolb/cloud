# Hono/OpenAPI Pattern

## Canonical Handler Flow

1. Route metadata (`describeRoute`).
2. Validation (`v(...)`).
3. Auth/permission check.
4. Service call.
5. `respond(c, result)`.

## Thin Wrapper Example

```ts
.get(
  "/:id",
  v("param", z.object({ id: z.uuid() })),
  async (c) => {
    const id = c.req.valid("param").id;
    return respond(c, service.resource.get({ id }));
  }
)
```

## Good Patterns

- Use helper functions for repeated guard checks (`requireXAccess`).
- Keep route-level permission intent explicit (`requiredLevel: "admin"`).
- Keep status/message wrappers centralized.
- Keep error mapping stable (`404` not found, `403` forbidden, `409` conflict).
- Keep ACL guard checks explicit before calling update/remove helpers.

## Avoid

- Domain branching and transforms in API handlers.
- ad-hoc error shape changes per route.
- bypassing `respond(...)` for normal JSON result flows.

## Allowed Transport Exceptions

- `new Response(stream)` for file/binary payloads.
- `c.text(...)` for plain text exports.
