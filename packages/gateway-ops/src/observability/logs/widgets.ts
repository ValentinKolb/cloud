import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import { hasRole } from "@valentinkolb/cloud/contracts";
import type { WidgetResponse, WidgetBlock } from "@valentinkolb/cloud/contracts";
import { loggingService } from "./service";

/**
 * Widget endpoints for the dashboard.
 *
 * Status code semantics (shared across every widget endpoint in the platform):
 *   - 200 → render
 *   - 204 → no content right now (data empty), widget is hidden but listed as
 *           toggleable in the dashboard's edit modal
 *   - 403 → user lacks the access level for this widget; modal lists it under
 *           "not available at your access level"
 *
 * `requireRole("*")` loads the session without enforcing it — we need the user
 * to decide between 403 and 200 ourselves.
 */
const app = new Hono<AuthContext>()
  .use(auth.requireRole("*"))
  .get("/errors", async (c) => {
    const user = c.get("user");
    if (!user || !hasRole(user, "admin")) return c.body(null, 403);

    const summary = await loggingService.stats.summary();
    const blocks: WidgetBlock[] = [
      {
        kind: "stat",
        // Stat grows to fill remaining vertical space; pills sit at the bottom.
        grow: true,
        value: summary.errors24h.toLocaleString(),
        label: "Errors · last 24h",
        sub: summary.errors24h > 0 ? "needs review" : "all quiet",
        valueClass: summary.errors24h > 0 ? "text-red-500" : undefined,
        accent:
          summary.errors24h > 0
            ? { tone: "red", icon: "ti ti-alert-circle" }
            : { tone: "emerald", icon: "ti ti-check" },
      },
      {
        kind: "pills",
        pills: [
          { label: "warn", value: summary.warnings24h, tone: summary.warnings24h > 0 ? "amber" : "zinc" },
          { label: "vol", value: summary.total24h.toLocaleString() },
          { label: "src", value: summary.sources, tone: "blue" },
        ],
      },
    ];

    const body: WidgetResponse = {
      title: "Logs",
      icon: "ti ti-list-tree",
      href: "/admin/observability/logs",
      meta: "last 24h",
      blocks,
    };
    return c.json(body);
  });

export default app;
