import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { expeditionsService } from "@/service";
import CreateExpeditionButton from "./CreateExpeditionButton.island";

/**
 * Expeditions list page (SSR).
 *
 * Pure server-render: we list every expedition the current user can see
 * (direct grant, group, authenticated, or public) and render them as link
 * cards. Interactivity is opt-in — only the "New expedition" button is
 * an island, everything else is plain HTML <a>.
 *
 * Pattern note: the page handler returns a function that returns JSX.
 * The platform's `ssr()` helper handles cookie loading, settings
 * snapshotting, and JSX → HTML serialization — the handler can stay
 * focused on data loading + composition.
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");

  const result = await expeditionsService.expedition.list({
    userId: user.id,
    groups: user.memberofGroupIds,
  });
  const expeditions = result.items;

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Expeditions" }]}>
      <div class="max-w-4xl mx-auto">
        {/* ── Hero ───────────────────────────────────────────────────────────
            Plain SSR; no interactivity. Acts as a visual anchor for the page. */}
        <div class="p-6 mb-4 text-center">
          <div class="flex items-center justify-center gap-3 mb-2">
            <div class="w-12 h-12 thumbnail bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <i class="ti ti-map-2 text-2xl text-zinc-600 dark:text-zinc-400" />
            </div>
          </div>
          <h1 class="text-xl font-semibold mb-1">Expeditions</h1>
          <p class="text-sm text-dimmed">
            Plan a journey, tick off waypoints, reach the summit.
          </p>
        </div>

        {/* ── Toolbar ────────────────────────────────────────────────────────
            Status line + the create button (the only island on this page). */}
        <div class="info-block-info mb-6 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <i class="ti ti-map-2 shrink-0" />
            <span>
              {expeditions.length === 0
                ? "No expeditions yet. Create one to get started!"
                : `${expeditions.length} expedition${expeditions.length !== 1 ? "s" : ""} accessible`}
            </span>
          </div>
          <CreateExpeditionButton />
        </div>

        {/* ── Cards ──────────────────────────────────────────────────────────
            One card per accessible expedition. Each card links to the detail
            page. Progress meter is computed from the list response (see
            `totalWaypoints` / `doneWaypoints` in `Expedition`). */}
        {expeditions.length > 0 && (
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {expeditions.map((expedition) => {
              const progress =
                expedition.totalWaypoints === 0
                  ? 0
                  : Math.round((expedition.doneWaypoints / expedition.totalWaypoints) * 100);
              const isDone = expedition.completedAt !== null;
              return (
                <a
                  href={`/app/expeditions/${expedition.id}`}
                  class="paper p-4 flex items-center gap-4 hover:paper-highlighted transition-all no-underline"
                >
                  <div
                    class={`w-10 h-10 thumbnail flex items-center justify-center shrink-0 ${
                      isDone
                        ? "bg-emerald-100 dark:bg-emerald-900/50"
                        : "bg-blue-100 dark:bg-blue-900/50"
                    }`}
                  >
                    <i
                      class={`${expedition.icon || "ti ti-map-2"} text-lg ${
                        isDone
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-blue-600 dark:text-blue-400"
                      }`}
                    />
                  </div>
                  <div class="flex-1 min-w-0">
                    <span class="text-sm font-semibold text-primary block truncate">
                      {expedition.title}
                    </span>
                    <p class="text-xs text-dimmed truncate">
                      {expedition.description ?? "No description"}
                    </p>
                    {/* Progress bar — purely visual; the hard truth is the
                        "done / total" ratio rendered just above it. */}
                    <div class="mt-2 flex items-center gap-2">
                      <div class="flex-1 h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          class={`h-full ${isDone ? "bg-emerald-500" : "bg-blue-500"}`}
                          style={`width: ${progress}%`}
                        />
                      </div>
                      <span class="text-[10px] text-dimmed shrink-0">
                        {expedition.doneWaypoints}/{expedition.totalWaypoints}
                      </span>
                    </div>
                  </div>
                  <i class="ti ti-chevron-right text-dimmed" />
                </a>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
});
