/**
 * The `middleware` namespace bundles the request-lifecycle primitives
 * that every cloud app composes into its own router. Apps register
 * what they need; the framework no longer injects anything implicitly.
 *
 *   import { middleware, auth } from "@valentinkolb/cloud/server"
 *
 *   const router = new Hono<AuthContext>()
 *     .use("*", middleware.logger())
 *     .use("*", middleware.runtime())     // for Layout / Sidebar / dashboard / search
 *     .use("*", middleware.settings())    // for c.get("settings")
 *     .use("*", middleware.ratelimit())
 *     .use(auth.requireRole("user"))
 *     .post(
 *       "/",
 *       middleware.validator("json", Schema),
 *       middleware.openapi({ tags: ["foo"], summary: "Create" }),
 *       handler,
 *     )
 *
 * `auth` lives separately because it has its own surface
 * (requireRole, redirectToLogin, session.*) and is conceptually
 * orthogonal to the request lifecycle.
 */
import { describeRoute } from "hono-openapi";
import { rateLimit } from "./rate-limit";
import { requestLogger } from "./request-logger";
import { runtime } from "./runtime";
import { settings } from "./settings";
import { validator } from "./validator";

export const middleware = {
  /** Live cluster registry on `c.get("runtime")`. Required for Layout/Sidebar. */
  runtime,
  /** Frozen per-request settings snapshot on `c.get("settings")`. */
  settings,
  /** HTTP request logger (logs 5xx as error, 429 as warn, 401/403 as info). */
  logger: () => requestLogger,
  /** Sliding-window rate limiter, keyed by user id (auto fallback to IP). */
  ratelimit: rateLimit,
  /** Zod input validator. `c.req.valid(target)` is fully typed afterward. */
  validator,
  /** OpenAPI route metadata — re-export of hono-openapi's `describeRoute`. */
  openapi: describeRoute,
} as const;
