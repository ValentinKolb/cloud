import type { AuthContext } from "@valentinkolb/cloud/server";
import { getRuntimeContext } from "@valentinkolb/cloud/ssr";
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
  const baseSlug = c.req.param("baseId")!;
  const defaultTabParam = c.req.query("defaultTab");
  const routeTabParam = c.req.param("tab");
  const sourceId = c.req.param("sourceId");
  const defaultTab =
    normalizeQueryReferenceTab(routeTabParam) ?? normalizeQueryReferenceTab(defaultTabParam) ?? (sourceId ? "tables" : "basics");
  c.get("page").title = defaultTab === "workflows" ? "Workflow reference" : defaultTab === "gql" ? "GQL reference" : "Grids reference";
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
  const recordCountsByTable = await gridsService.record.countAccessibleByTable(
    catalog.tables.flatMap((table) => {
      const access = gridsService.permission.resolveRecordAccess(
        grants,
        { baseId: base.id, tableId: table.id },
        "read",
        user.id,
      ).recordAccess;
      return access ? [{ tableId: table.id, recordAccess: access }] : [];
    }),
  );
  const helpDocuments = getRuntimeContext(c).apps.find((registeredApp) => registeredApp.id === "grids")?.help?.documents ?? [];

  return () => (
    <QueryReferenceWindow
      baseId={base.id}
      baseShortId={base.shortId}
      baseName={base.name}
      tables={catalog.tables}
      fieldsByTable={catalog.fieldsByTable}
      viewsByTable={catalog.viewsByTable}
      recordCountsByTable={recordCountsByTable}
      documents={helpDocuments}
      defaultTab={defaultTab}
      inspectedSourceId={sourceId}
    />
  );
});
