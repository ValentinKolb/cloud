# App Builder Import Map

## Contracts

```ts
import type { AppFacade, AppSearchInput, AppSearchResult } from "@valentinkolb/cloud/contracts/app";
```

## Server wrappers

```ts
import { respond } from "@valentinkolb/cloud-lib/server/api/respond";
import { v } from "@valentinkolb/cloud-lib/server/middleware/validator";
import { auth } from "@valentinkolb/cloud-lib/server/middleware/auth";
import { jsonResponse, requiresAuth } from "@valentinkolb/cloud-lib/server/middleware/openapi";
```

## Service result helpers

```ts
import { ok, fail, err, paginate, type Result } from "@valentinkolb/cloud-lib/server/services/result";
```

## Logging (Server-Side App Code)

```ts
import { logger } from "@valentinkolb/cloud-lib/server/services/logging";

const log = logger("app.my-app.service");
log.info("Created entity", { entityId });
```

## Frontend shared UI

```ts
import { TextInput, Select, RemoveBtn, PermissionEditor } from "@valentinkolb/cloud-lib/ui";
import { SearchBar } from "@valentinkolb/cloud-lib/islands";
import { markdown, dates, calendar, icons } from "@valentinkolb/cloud-lib/shared";
```

## Facade skeleton

```ts
import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";

import apiRoutes from "./api";
import pageRoutes from "./pages";
import { myService } from "./service";

const app = {
  meta: {
    id: "my-app",
    name: "My App",
    icon: "ti ti-apps",
    description: "Short app description.",
    nav: {
      href: "/app/my-app",
      match: "/app/my-app",
      section: "more",
      requiresAuth: true,
    },
  },
  service: myService,
  routes: {
    api: new Hono().route("/app/my-app", apiRoutes),
    pages: new Hono().route("/app/my-app", pageRoutes),
  },
} satisfies AppFacade<typeof myService>;

export default app;
export { myService as service };
export type { ApiType } from "./api";
```

## Optional Search Capability

```ts
const search = async (input: AppSearchInput): Promise<AppSearchResult[]> => {
  const user = input.ctx.get("user");
  // app-local search logic
  return [
    {
      id: "entity-1",
      title: "Entity",
      href: "/app/my-app/entity-1",
      priority: 6,
      metadata: [
        { label: "Type", value: "Entity" },
      ],
      previewUrl: "/api/app/my-app/entity-1/thumbnail",
    },
  ].slice(0, input.limit);
};

const app = {
  // ...
  capabilities: {
    search: { run: search },
  },
} satisfies AppFacade<typeof myService>;
```
