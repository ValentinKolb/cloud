# Core Services

Runtime-owned backend services live in `@valentinkolb/cloud-core/services/*` (for example `settings`, `logging`, `session`, `ipa`).

Reusable app-builder server primitives live in `@valentinkolb/cloud-lib/server`.

## Server Library Catalog (`@valentinkolb/cloud-lib/server/services`)

- `access`: shared ACL primitives and principal resolution.
- `geo`: location lookup abstraction.
- `images`: image/fallback helpers.
- `password`: password generation helper.
- `result`: `ok/fail/err/paginate/tryCatch` helpers.

## API/Middleware Primitives

- `respond(...)`: maps service `Result` to HTTP responses.
- `v.*`: zod/openapi validation wrappers.
- `auth.*`: auth/role middleware.
- `rateLimit(...)`: simple app-level rate limit middleware.
- `openapi` helpers: route metadata and response schema helpers.

## Result Pattern

Use the shared result helpers from `@valentinkolb/cloud-lib/server/services/result`:

- `ok`, `fail`, `err`, `unwrap`, `paginate`, `tryCatch`

Services should return result objects for expected failures and throw only on unexpected bugs.

## Logging in Apps

Use the runtime logger factory:

```ts
import { logger } from "@valentinkolb/cloud-core/services/logging";

const log = logger("my-app");
```
