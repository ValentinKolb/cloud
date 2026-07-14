import type { AuthContext } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { currentActorUser } from "../../../api/permissions";
import { ssr } from "../../../config";
import { gridsService } from "../../../service";
import QueryReferenceWindow, { normalizeQueryReferenceTab } from "../../_components/query/QueryReferenceWindow";

const messagePage =
  (message: string, icon = "ti-alert-circle") =>
  () => (
    <main class="min-h-screen bg-[var(--ui-canvas)] p-[var(--ui-space-shell)]">
      <div class="paper mx-auto mt-16 max-w-md p-8 text-center text-dimmed">
        <i class={`ti ${icon} text-sm`} /> {message}
      </div>
    </main>
  );

export default ssr<AuthContext>(async (c) => {
  c.get("page").title = "GQL reference";
  const baseSlug = c.req.param("baseId")!;
  const defaultTabParam = c.req.query("defaultTab");
  const routeTabParam = c.req.param("tab");
  const sourceId = c.req.param("sourceId");
  const defaultTab =
    normalizeQueryReferenceTab(routeTabParam) ?? normalizeQueryReferenceTab(defaultTabParam) ?? (sourceId ? "tables" : "basics");
  const base = await gridsService.base.getByIdOrShortId(baseSlug);
  if (!base) return messagePage("Base not found");

  const user = currentActorUser(c);
  if (!user) return messagePage("Sign in to open the Grids reference.", "ti-lock");

  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId: base.id,
  });
  const baseLevel = gridsService.permission.resolve(grants, { baseId: base.id });
  if (!gridsService.permission.hasAtLeast(baseLevel, "read")) return messagePage("No access to this base", "ti-lock");

  const catalog = await gridsService.base.catalog({
    baseId: base.id,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });
  const tableIds = catalog.tables.map((table) => table.id);
  const countRows =
    tableIds.length > 0
      ? await sql`
          SELECT table_id, COUNT(*)::int AS record_count
          FROM grids.records
          WHERE table_id = ANY(${sql.array(tableIds, "UUID")})
            AND deleted_at IS NULL
          GROUP BY table_id
        `
      : [];
  const recordCountsByTable = Object.fromEntries(
    countRows.map((row: { table_id: string; record_count: number | string | null }) => [row.table_id, Number(row.record_count ?? 0)]),
  ) as Record<string, number>;

  return () => (
    <QueryReferenceWindow
      baseId={base.id}
      baseShortId={base.shortId}
      baseName={base.name}
      tables={catalog.tables}
      fieldsByTable={catalog.fieldsByTable}
      viewsByTable={catalog.viewsByTable}
      recordCountsByTable={recordCountsByTable}
      defaultTab={defaultTab}
      inspectedSourceId={sourceId}
    />
  );
});
