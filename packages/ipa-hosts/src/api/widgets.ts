import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import { hasRole } from "@valentinkolb/cloud/contracts";
import type { WidgetResponse, WidgetBlock } from "@valentinkolb/cloud/contracts";
import { ipaHostsService } from "../service";

/**
 * IPA hosts sync widget — admin only. Status banner reports whether every
 * mirrored host has at least one hostgroup membership; pills carry the raw
 * counts so the admin can decide whether to dive into /admin/ipa-hosts.
 */
const app = new Hono<AuthContext>()
  .use(auth.requireRole("*"))
  .get("/sync", async (c) => {
    const user = c.get("user");
    // 403 = admin-only widget.
    if (!user || !hasRole(user, "admin")) return c.body(null, 403);

    const stats = await ipaHostsService.stats();

    const blocks: WidgetBlock[] = [];

    if (stats.hostsTotal === 0 && stats.hostgroupsTotal === 0) {
      // Empty mirror (fresh install) — point the admin to the sync action.
      blocks.push({
        kind: "hero",
        icon: "ti ti-server-off",
        tone: "blue",
        title: "Empty mirror",
        subtitle: "Run a sync to import hosts and hostgroups from FreeIPA",
      });
    } else {
      const tone: "ok" | "warn" = stats.hostsUngrouped > 0 ? "warn" : "ok";
      blocks.push({
        kind: "status",
        grow: true,
        tone,
        title:
          stats.hostsUngrouped === 0
            ? `${stats.hostsTotal} hosts · all assigned`
            : `${stats.hostsUngrouped} ungrouped host${stats.hostsUngrouped === 1 ? "" : "s"}`,
        message:
          stats.hostsUngrouped === 0
            ? `${stats.hostgroupsTotal} hostgroups mirrored from FreeIPA`
            : `Out of ${stats.hostsTotal} mirrored hosts`,
        icon: "ti ti-server",
      });
      blocks.push({
        kind: "pills",
        pills: [
          { label: "groups", value: stats.hostgroupsTotal, tone: "blue" },
          { label: "in groups", value: stats.hostsInGroups },
          ...(stats.hostsUngrouped > 0
            ? [{ label: "ungrouped", value: stats.hostsUngrouped, tone: "amber" as const }]
            : []),
        ],
      });
    }

    const body: WidgetResponse = {
      title: "IPA hosts",
      icon: "ti ti-server",
      href: "/admin/ipa-hosts",
      blocks,
    };
    return c.json(body);
  });

export default app;
