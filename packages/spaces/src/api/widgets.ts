import type { WidgetBlock, WidgetListItem, WidgetResponse, WidgetTone } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, getDateConfig } from "@valentinkolb/cloud/server";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { Hono } from "hono";
import { spacesService } from "../service";

/**
 * Spaces dashboard widget — today's events + next-up todos for the user,
 * across every accessible space. Composition decided server-side based on
 * what the user actually has:
 *
 *   - 0 todos AND 0 events  → 204 silent skip
 *   - has events            → list block "Today" first
 *   - has open todos        → stat block + list block (top deadlines)
 *
 * Priority maps to coloured icon for at-a-glance triage.
 */
type Priority = "low" | "medium" | "high" | "urgent" | null;

const priorityIcon: Record<Exclude<Priority, null>, { icon: string; tone: WidgetTone }> = {
  urgent: { icon: "ti ti-flame", tone: "red" },
  high: { icon: "ti ti-flag-3", tone: "amber" },
  medium: { icon: "ti ti-flag-3", tone: "blue" },
  low: { icon: "ti ti-flag-3", tone: "zinc" },
};

const todoIcon = (priority: Priority): { icon: string; iconTone?: WidgetTone } => {
  if (priority && priorityIcon[priority]) {
    return { icon: priorityIcon[priority].icon, iconTone: priorityIcon[priority].tone };
  }
  return { icon: "ti ti-circle" };
};

const formatRelativeDeadline = (iso: string | null): string | undefined => {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return "overdue";
  const hours = ms / 3600_000;
  if (hours < 24) return `in ${Math.round(hours)}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
};

const formatTimeRange = (startsAt: string | null, endsAt: string | null, dateConfig?: DateContext): string => {
  const fmt = (iso: string) => dates.formatTime(iso, dateConfig);
  if (startsAt && endsAt) return `${fmt(startsAt)}–${fmt(endsAt)}`;
  if (startsAt) return fmt(startsAt);
  return "today";
};

const app = new Hono<AuthContext>().use(auth.requireRole("*")).get("/today", async (c) => {
  const user = c.get("user");
  // 403 = unauthenticated; signed-in users always have access (data may be empty → 204).
  if (!user) return c.body(null, 403);

  const groups = Array.isArray(user.memberofGroupIds) ? user.memberofGroupIds : [];
  const dateConfig = getDateConfig(c);
  const snap = await spacesService.item.dashboardSnapshot({
    userId: user.id,
    groups,
    todoLimit: 5,
    dateConfig,
  });

  if (snap.openTodoCount === 0 && snap.events.length === 0) {
    const body: WidgetResponse = {
      title: "Today",
      icon: "ti ti-checklist",
      href: "/app/spaces",
      blocks: [
        {
          kind: "hero",
          icon: "ti ti-circle-check",
          tone: "emerald",
          title: "Nothing on today",
          subtitle: "No events scheduled and no open todos",
        },
      ],
    };
    return c.json(body);
  }

  const blocks: WidgetBlock[] = [];

  // Stat first: open todos at a glance.
  blocks.push({
    kind: "stat",
    value: snap.openTodoCount,
    label: snap.openTodoCount === 1 ? "Open todo" : "Open todos",
    sub: snap.urgentCount > 0 ? `${snap.urgentCount} urgent` : "all caught up on urgent",
    valueClass: snap.urgentCount > 0 ? "text-amber-600 dark:text-amber-400" : undefined,
    accent: snap.urgentCount > 0 ? { tone: "red", icon: "ti ti-flame" } : undefined,
  });

  // Combine events and todos into a single growing list to fit fixed height.
  // Events first (they have a clock + time meta), then deadlines.
  const items: WidgetListItem[] = [
    ...snap.events.map(
      (e): WidgetListItem => ({
        icon: "ti ti-clock",
        iconTone: "blue",
        label: e.title,
        sub: e.spaceName,
        meta: formatTimeRange(e.startsAt, e.endsAt, dateConfig),
        href: `/app/spaces/${e.spaceId}/${e.id}`,
      }),
    ),
    ...snap.todos.map((t): WidgetListItem => {
      const ic = todoIcon(t.priority);
      return {
        icon: ic.icon,
        iconTone: ic.iconTone,
        label: t.title,
        sub: t.spaceName,
        meta: formatRelativeDeadline(t.deadline),
        href: `/app/spaces/${t.spaceId}/${t.id}`,
      };
    }),
  ];
  blocks.push({ kind: "list", items, grow: true });

  const body: WidgetResponse = {
    title: snap.events.length > 0 ? "Today" : "Open todos",
    icon: "ti ti-checklist",
    href: "/app/spaces",
    blocks,
  };
  return c.json(body);
});

export default app;
