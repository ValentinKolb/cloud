import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";

/**
 * Bases index page — lists all bases the current user can access.
 * Read-only in the first impl streak; create flow comes in 1C.
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const isAdmin = hasRole(user, "admin");

  const all = await gridsService.base.list();
  // Filter to those the user can read. Platform admins see everything.
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
      <div class="max-w-4xl mx-auto flex flex-col gap-4">
        <h1 class="text-xl font-bold text-primary" style="view-transition-name: page-header">
          <i class="ti ti-table" /> Bases
        </h1>

        {visible.length > 0 ? (
          <div class="flex flex-col gap-2">
            {visible.map((base) => (
              <a
                href={`/app/grids/${base.id}`}
                class="paper p-4 flex items-start gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                <i class="ti ti-database text-lg text-dimmed mt-0.5" />
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-primary truncate">{base.name}</div>
                  {base.description && (
                    <div class="text-sm text-dimmed mt-1 line-clamp-2">{base.description}</div>
                  )}
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div class="paper p-6 text-center text-sm text-dimmed">
            No bases yet. Create one via the API — UI flow lands in the 1C polish phase.
          </div>
        )}
      </div>
    </Layout>
  );
});
