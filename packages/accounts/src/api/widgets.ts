import type { WidgetBlock, WidgetResponse } from "@valentinkolb/cloud/contracts";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { accountsAppService } from "@valentinkolb/cloud/services";
import { Hono } from "hono";
import { getUserBackedActor } from "@/shared/actor";

/**
 * Admin queue widget — pending account requests + accounts expiring soon.
 * Hidden (204) for non-admins; vanishes entirely if there's nothing to act on.
 */
const app = new Hono<AuthContext>().use(auth.requireRole("*")).get("/admin-queue", async (c) => {
  const user = getUserBackedActor(c);
  // 403 = no access (modal shows under "not available at your access level").
  if (!user || !hasRole(user, "admin")) return c.body(null, 403);

  const summary = await accountsAppService.dashboard.get();
  const expiring = summary.ipaExpiring30d + summary.localUserExpiring30d + summary.localGuestExpiring30d;

  const blocks: WidgetBlock[] = [];

  if (summary.openRequests === 0 && expiring === 0) {
    // Empty state — admin sees a positive hero, plus the totals as context pills.
    blocks.push({
      kind: "hero",
      icon: "ti ti-circle-check",
      tone: "emerald",
      title: "All clear",
      subtitle: "No pending requests and nothing expiring",
    });
  } else {
    if (summary.openRequests > 0) {
      blocks.push({
        kind: "stat",
        grow: true,
        value: summary.openRequests,
        label: summary.openRequests === 1 ? "Pending request" : "Pending requests",
        sub: "needs review",
        valueClass: "text-amber-600 dark:text-amber-400",
        accent: { tone: "amber", icon: "ti ti-clock", text: "open" },
      });
    }
    if (expiring > 0) {
      blocks.push({
        kind: "status",
        tone: "warn",
        title: `${expiring} account${expiring === 1 ? "" : "s"} expiring within 30 days`,
        message: `${summary.ipaExpiring30d} IPA · ${summary.localUserExpiring30d} local user · ${summary.localGuestExpiring30d} guest`,
        icon: "ti ti-calendar-due",
      });
    }
  }

  blocks.push({
    kind: "pills",
    pills: [
      { label: "accts", value: summary.ipaAccountsTotal + summary.localAccountsTotal },
      { label: "groups", value: summary.groupsTotal },
      ...(summary.openRequests > 0 ? [{ label: "queue", value: summary.openRequests, tone: "amber" as const }] : []),
    ],
  });

  const body: WidgetResponse = {
    title: "Admin queue",
    icon: "ti ti-users-group",
    href: "/app/accounts",
    blocks,
  };
  return c.json(body);
});

export default app;
