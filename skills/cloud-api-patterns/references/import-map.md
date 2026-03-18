# API Pattern Import Map

## Canonical imports for `api.ts`

```ts
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import {
  respond,
  v,
  auth, type AuthContext,
  rateLimit,
  jsonResponse, requiresAuth,
  ok, fail, err,
} from "@valentinkolb/cloud/lib/server";
```

## Wrapper shape

```ts
const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("authenticated"))
  .get(
    "/",
    describeRoute({
      tags: ["Example"],
      summary: "List items",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.object({ data: z.array(z.string()) }), "Items"),
      },
    }),
    v("query", z.object({ q: z.string().optional() })),
    async (c) => {
      return respond(c, ok({ data: ["a", "b"] }));
    }
  );
```

## Exceptions

Use raw `Response`/`c.text(...)` only for transport-driven endpoints:

- file/binary streams
- iCal/text downloads
