import type { AuthContext } from "@valentinkolb/cloud/server";
import { currentActorUser, gateBaseAtAccess, gridsAccessContext } from "../../../../../api/permissions";
import { ssr } from "../../../../../config";
import { gridsService } from "../../../../../service";
import FormulaReferenceWindow from "../../../../_components/fields/FormulaReferenceWindow.island";

export default ssr<AuthContext>(async (c) => {
  c.get("page").title = "Formula reference";
  const baseSlug = c.req.param("baseId")!;
  const tableSlug = c.req.param("tableId")!;
  const base = await gridsService.base.getByShortId(baseSlug);

  if (!base) {
    return () => (
      <main class="min-h-screen bg-[var(--ui-canvas)] p-[var(--ui-space-shell)]">
        <div class="paper mx-auto mt-16 max-w-md p-8 text-center text-dimmed">Base not found</div>
      </main>
    );
  }

  const table = await gridsService.table.getByShortIdForBase(base.id, tableSlug);
  if (!table) {
    return () => (
      <main class="min-h-screen bg-[var(--ui-canvas)] p-[var(--ui-space-shell)]">
        <div class="paper mx-auto mt-16 max-w-md p-8 text-center text-dimmed">Table not found</div>
      </main>
    );
  }

  const user = currentActorUser(c);
  if (!user) {
    return () => (
      <main class="min-h-screen bg-[var(--ui-canvas)] p-[var(--ui-space-shell)]">
        <div class="paper mx-auto mt-16 max-w-md p-8 text-center text-dimmed">
          <i class="ti ti-lock text-sm" /> Sign in to open the formula reference.
        </div>
      </main>
    );
  }

  if (!(await gateBaseAtAccess(gridsAccessContext(c), base.id, "read")).ok) {
    return () => (
      <main class="min-h-screen bg-[var(--ui-canvas)] p-[var(--ui-space-shell)]">
        <div class="paper mx-auto mt-16 max-w-md p-8 text-center text-dimmed">
          <i class="ti ti-lock text-sm" /> No access to this table
        </div>
      </main>
    );
  }

  const fields = await gridsService.field.listByTable(table.id);
  const currentFieldId = new URL(c.req.url).searchParams.get("field");

  return () => <FormulaReferenceWindow tableName={table.name} fields={fields} currentFieldId={currentFieldId} />;
});
