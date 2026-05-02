import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import CreateBaseButton from "./_components/CreateBaseButton.island";

/**
 * Bases list page — shows every base the user has access to.
 * Layout matches the spaces / notebooks index pages: hero + info-block
 * with the create button + paper-card grid.
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const isAdmin = hasRole(user, "admin");

  const all = await gridsService.base.list();
  const visible = isAdmin
    ? all
    : (
        await Promise.all(
          all.map(async (b) => {
            const grants = await gridsService.permission.loadGrants({
              userId: user.id,
              userGroups: user.memberofGroupIds,
              baseId: b.id,
            });
            const level = gridsService.permission.resolve(grants, { baseId: b.id });
            return gridsService.permission.hasAtLeast(level, "read") ? b : null;
          }),
        )
      ).filter((b): b is NonNullable<typeof b> => b !== null);

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Grids" }]}>
      <div class="max-w-4xl mx-auto">
        {/* Hero */}
        <div class="p-6 mb-4 text-center">
          <div class="flex items-center justify-center gap-3 mb-2">
            <div class="w-12 h-12 thumbnail bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <i class="ti ti-table text-2xl text-zinc-600 dark:text-zinc-400" />
            </div>
          </div>
          <h1 class="text-xl font-semibold mb-1">Grids</h1>
          <p class="text-sm text-dimmed">Flexible tables — bases, fields, records, views, forms</p>
        </div>

        {/* Info block */}
        <div class="info-block-info mb-6 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <i class="ti ti-database shrink-0" />
            <span>
              {visible.length === 0
                ? "No bases yet. Create one to get started!"
                : `${visible.length} base${visible.length !== 1 ? "s" : ""} available`}
            </span>
          </div>
          <CreateBaseButton />
        </div>

        {/* Bases grid */}
        {visible.length > 0 && (
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {visible.map((base) => (
              <a
                href={`/app/grids/${base.id}`}
                class="paper p-4 flex items-center gap-4 hover:paper-highlighted transition-all no-underline"
                style={`view-transition-name: grids-base-card-${base.id}`}
              >
                <div class="w-10 h-10 thumbnail bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0">
                  <i class="ti ti-database text-lg text-blue-600 dark:text-blue-400" />
                </div>
                <div class="flex-1 min-w-0">
                  <span
                    class="text-sm font-semibold text-primary block truncate"
                    style={`view-transition-name: grids-base-name-${base.id}`}
                  >
                    {base.name}
                  </span>
                  <p class="text-xs text-dimmed truncate">{base.description || "No description"}</p>
                </div>
                <i class="ti ti-chevron-right text-dimmed" />
              </a>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
});
