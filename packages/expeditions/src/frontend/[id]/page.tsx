import { ssr } from "../../config";
import { Layout } from "@valentinkolb/cloud/ssr";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { expeditionsService } from "@/service";
import AddWaypointButton from "../AddWaypointButton.island";
import WaypointToggle from "../WaypointToggle.island";
import DeleteWaypointButton from "../DeleteWaypointButton.island";
import DeleteExpeditionButton from "../DeleteExpeditionButton.island";
import ExpeditionPermissionsButton from "../ExpeditionPermissionsButton.island";

/**
 * Expedition detail page (SSR).
 *
 * Loads the expedition + every waypoint server-side and renders them as
 * a checklist. The toggle, add, delete buttons are islands — each is a
 * minimal component that calls the typed `apiClient` and refreshes the
 * page on success (no client-side state, no client-side data fetching;
 * the SSR pass is the source of truth).
 *
 * Three permission levels are observed:
 *   read   → you see the page but every action is hidden
 *   write  → you can toggle / add / delete waypoints
 *   admin  → you can also delete the whole expedition or edit access
 *
 * The page itself doesn't 404 on missing access — it shows a polite
 * "you don't have access" panel inside the normal Layout, which is the
 * platform convention. (The API still returns 403 for the underlying calls.)
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const expeditionId = c.req.param("id");

  // Load the entity. Missing → render an in-Layout 404, not a redirect.
  const expedition = await expeditionsService.expedition.get({ id: expeditionId });
  if (!expedition) {
    return () => (
      <Layout c={c} title="Not Found">
        <div class="max-w-md mx-auto mt-16">
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-alert-circle text-sm" />
            Expedition not found
          </div>
        </div>
      </Layout>
    );
  }

  // Resolve the viewer's permission level once, then derive UI gates from it.
  const permission = await expeditionsService.expedition.permission.get({
    expeditionId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });
  if (permission === "none") {
    return () => (
      <Layout c={c} title="Access Denied">
        <div class="max-w-md mx-auto mt-16">
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-lock text-sm" />
            You don't have access to this expedition
          </div>
        </div>
      </Layout>
    );
  }

  const isAdmin = permission === "admin";
  const canWrite = permission === "write" || isAdmin;

  const waypoints = await expeditionsService.waypoint.list({ expeditionId });
  const totalDone = waypoints.filter((w) => w.doneAt !== null).length;
  const total = waypoints.length;
  const progress = total === 0 ? 0 : Math.round((totalDone / total) * 100);

  return () => (
    <Layout
      c={c}
      title={[
        { title: "Start", href: "/" },
        { title: "Expeditions", href: "/app/expeditions" },
        { title: expedition.title },
      ]}
    >
      <div class="max-w-2xl mx-auto">
        {/* ── Header ─────────────────────────────────────────────────────────
            Title, description, and the destructive admin actions (permissions
            dialog + delete). Buttons are gated by `isAdmin`. */}
        <header class="paper p-5 mb-4">
          <div class="flex items-start gap-4">
            <div
              class={`w-12 h-12 thumbnail flex items-center justify-center shrink-0 ${
                expedition.completedAt
                  ? "bg-emerald-100 dark:bg-emerald-900/50"
                  : "bg-blue-100 dark:bg-blue-900/50"
              }`}
            >
              <i
                class={`${expedition.icon || "ti ti-map-2"} text-2xl ${
                  expedition.completedAt
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-blue-600 dark:text-blue-400"
                }`}
              />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h1 class="text-lg font-semibold">{expedition.title}</h1>
                {expedition.completedAt ? (
                  <span class="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    <i class="ti ti-flag-check" /> completed
                  </span>
                ) : null}
              </div>
              {expedition.description ? (
                <p class="text-sm text-dimmed mt-1 whitespace-pre-wrap">{expedition.description}</p>
              ) : null}
              <div class="mt-3 flex items-center gap-2">
                <div class="flex-1 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    class={`h-full transition-all ${expedition.completedAt ? "bg-emerald-500" : "bg-blue-500"}`}
                    style={`width: ${progress}%`}
                  />
                </div>
                <span class="text-xs text-dimmed shrink-0">
                  {totalDone}/{total} waypoints
                </span>
              </div>
            </div>
            {isAdmin ? (
              <div class="flex items-center gap-1 shrink-0">
                <ExpeditionPermissionsButton expeditionId={expedition.id} expeditionTitle={expedition.title} />
                <DeleteExpeditionButton expeditionId={expedition.id} expeditionTitle={expedition.title} />
              </div>
            ) : null}
          </div>
        </header>

        {/* ── Waypoints ──────────────────────────────────────────────────────
            One row per waypoint. The toggle + delete buttons are islands;
            the row itself is plain SSR. Reading-only viewers see a static
            list with disabled-looking checkboxes. */}
        <section class="paper">
          <div class="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <span class="text-xs font-semibold uppercase tracking-wider text-secondary">Waypoints</span>
            {canWrite ? <AddWaypointButton expeditionId={expedition.id} /> : null}
          </div>

          {waypoints.length === 0 ? (
            <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
              <i class="ti ti-map-pin-off text-sm" />
              {canWrite ? "No waypoints yet — add one to get started." : "No waypoints yet."}
            </p>
          ) : (
            <ul class="divide-y divide-zinc-100 dark:divide-zinc-800">
              {waypoints.map((w) => (
                <li class="flex items-center gap-3 px-4 py-2.5">
                  {canWrite ? (
                    <WaypointToggle expeditionId={expedition.id} waypointId={w.id} done={w.doneAt !== null} />
                  ) : (
                    // Read-only viewers see the state but can't toggle.
                    <i
                      class={`${w.doneAt !== null ? "ti ti-circle-check text-emerald-500" : "ti ti-circle text-dimmed"} text-lg`}
                      aria-hidden="true"
                    />
                  )}
                  <span
                    class={`flex-1 text-sm ${w.doneAt !== null ? "line-through text-dimmed" : "text-primary"}`}
                  >
                    {w.title}
                  </span>
                  {canWrite ? (
                    <DeleteWaypointButton
                      expeditionId={expedition.id}
                      waypointId={w.id}
                      waypointTitle={w.title}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Layout>
  );
});
