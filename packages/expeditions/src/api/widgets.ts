import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import type {
  WidgetResponse,
  WidgetBlock,
  WidgetListItem,
} from "@valentinkolb/cloud/contracts";
import { expeditionsService } from "../service";

/**
 * Dashboard widget for the expeditions app.
 *
 * Visibility rules across the platform:
 *   - 200 + body  → render the widget normally (incl. empty-state hero)
 *   - 403         → render in the "locked at your access level" group
 *
 * For this app:
 *   - signed-in but no expeditions → 200 with a "no expeditions yet" hero
 *   - 1+ active expeditions        → list them with a progress meta string
 *   - all expeditions completed    → 200 with a celebratory "all done" hero
 *
 * Anonymous users get 403 (the widget needs a user to be useful at all).
 */
const app = new Hono<AuthContext>()
  .use(auth.requireRole("*"))
  .get("/active", async (c) => {
    const user = c.get("user");
    if (!user) return c.body(null, 403);

    const groups = Array.isArray(user.memberofGroupIds) ? user.memberofGroupIds : [];
    const result = await expeditionsService.expedition.list({
      userId: user.id,
      groups,
    });
    const expeditions = result.items;

    // Empty-state hero — never silently 204; the user sees a friendly nudge.
    if (expeditions.length === 0) {
      const body: WidgetResponse = {
        title: "Expeditions",
        icon: "ti ti-map-2",
        href: "/app/expeditions",
        blocks: [
          {
            kind: "hero",
            icon: "ti ti-compass",
            tone: "blue",
            title: "No expeditions yet",
            subtitle: "Create one to start tracking waypoints",
          },
        ],
      };
      return c.json(body);
    }

    const active = expeditions.filter((e) => e.completedAt === null);

    // Everything done? Celebrate. (Limit 5 widgets per row, no need to list each.)
    if (active.length === 0) {
      const body: WidgetResponse = {
        title: "Expeditions",
        icon: "ti ti-map-2",
        href: "/app/expeditions",
        blocks: [
          {
            kind: "hero",
            icon: "ti ti-flag-check",
            tone: "emerald",
            title: "All expeditions completed",
            subtitle: `${expeditions.length} reached the summit`,
          },
        ],
      };
      return c.json(body);
    }

    // Active list — top 6 by recency, with a "X / Y" progress meta string.
    const items: WidgetListItem[] = active.slice(0, 6).map((e): WidgetListItem => ({
      icon: e.icon || "ti ti-map-2",
      label: e.title,
      sub: e.description ?? undefined,
      meta: `${e.doneWaypoints}/${e.totalWaypoints}`,
      href: `/app/expeditions/${e.id}`,
    }));

    const blocks: WidgetBlock[] = [{ kind: "list", items, grow: true }];

    const body: WidgetResponse = {
      title: "Expeditions",
      icon: "ti ti-map-2",
      href: "/app/expeditions",
      blocks,
    };
    return c.json(body);
  });

export default app;
