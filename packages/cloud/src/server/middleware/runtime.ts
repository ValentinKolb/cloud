/**
 * Per-request middleware that exposes the live cluster registry on
 * `c.get("runtime")`. The first call to this middleware kicks off the
 * Redis registry watcher (idempotent); subsequent requests read from
 * the in-memory snapshot.
 *
 * Required by anything that renders the framework's `<Layout>`,
 * `<Sidebar>`, dashboard widget aggregator, or `Cmd+K` global search.
 */
import { createMiddleware } from "hono/factory";
import { ensureRuntimeWatcher, getCurrentRuntime } from "../../_internal/runtime-watcher";

export const runtime = () =>
  createMiddleware(async (c, next) => {
    await ensureRuntimeWatcher();
    (c as unknown as { set: (k: string, v: unknown) => void }).set("runtime", getCurrentRuntime());
    await next();
  });
