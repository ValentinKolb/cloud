# API Pattern Import Map

## Canonical imports for `api.ts`

```ts
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { respond } from "@valentinkolb/cloud-lib/server/api/respond";
import { v } from "@valentinkolb/cloud-lib/server/middleware/validator";
import { auth, type AuthContext } from "@valentinkolb/cloud-lib/server/middleware/auth";
import { rateLimit } from "@valentinkolb/cloud-lib/server/middleware/rate-limit";
import { jsonResponse, requiresAuth } from "@valentinkolb/cloud-lib/server/middleware/openapi";
import { ok, fail, err } from "@valentinkolb/cloud-lib/server/services/result";
import { logger } from "@valentinkolb/cloud-lib/server/services/logging";
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
