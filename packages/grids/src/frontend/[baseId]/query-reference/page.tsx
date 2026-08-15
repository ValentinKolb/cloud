import type { AuthContext } from "@valentinkolb/cloud/server";
import { getRuntimeContext } from "@valentinkolb/cloud/ssr";
import { currentActorUser, gateBaseAtAccess, gridsAccessContext } from "../../../api/permissions";
import { toPublicFields, toPublicTables, toPublicViews } from "../../../api/public-dto";
import { ssr } from "../../../config";
import { gridsService } from "../../../service";
import { ALL_RECORD_ACCESS } from "../../../service/record-access";
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
  const base = await gridsService.base.getByShortId(baseSlug);
  if (!base) return messagePage("Base not found");

  const user = currentActorUser(c);
  if (!user) return messagePage("Sign in to open the Grids reference.", "ti-lock");

  const gate = await gateBaseAtAccess(gridsAccessContext(c), base.id, "read");
  if (!gate.ok) return messagePage("No access to this base", "ti-lock");

  const catalog = await gridsService.base.catalog({
    baseId: base.id,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });
  const recordCountsByTable = await gridsService.record.countAccessibleByTable(
    catalog.tables.map((table) => ({ tableId: table.id, recordAccess: ALL_RECORD_ACCESS })),
  );
  const publicTables = await toPublicTables(catalog.tables);
  const publicTableIds = new Map<string, string>();
  for (const [index, table] of catalog.tables.entries()) {
    const publicTable = publicTables[index];
    if (publicTable) publicTableIds.set(table.id, publicTable.id);
  }
  const publicTableId = (internalId: string) => {
    const id = publicTableIds.get(internalId);
    if (!id) throw new Error("Missing public table ID");
    return id;
  };
  const publicFieldsByTable = Object.fromEntries(
    await Promise.all(
      Object.entries(catalog.fieldsByTable).map(
        async ([tableId, fields]) => [publicTableId(tableId), await toPublicFields(fields)] as const,
      ),
    ),
  );
  const publicViewsByTable = Object.fromEntries(
    await Promise.all(
      Object.entries(catalog.viewsByTable).map(async ([tableId, views]) => [publicTableId(tableId), await toPublicViews(views)] as const),
    ),
  );
  const publicRecordCountsByTable = Object.fromEntries(
    Object.entries(recordCountsByTable).map(([tableId, count]) => [publicTableId(tableId), count]),
  );
  const helpDocuments = getRuntimeContext(c).apps.find((registeredApp) => registeredApp.id === "grids")?.help?.documents ?? [];

  return () => (
    <QueryReferenceWindow
      baseId={base.shortId}
      baseName={base.name}
      tables={publicTables}
      fieldsByTable={publicFieldsByTable}
      viewsByTable={publicViewsByTable}
      recordCountsByTable={publicRecordCountsByTable}
      documents={helpDocuments}
      defaultTab={defaultTab}
      inspectedSourceId={sourceId}
    />
  );
});
