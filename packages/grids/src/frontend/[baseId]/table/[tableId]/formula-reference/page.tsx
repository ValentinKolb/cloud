import type { AuthContext } from "@valentinkolb/cloud/server";
import { currentActorUser } from "../../../../../api/permissions";
import { ssr } from "../../../../../config";
import { gridsService } from "../../../../../service";
import FormulaReferenceWindow from "../../../../_components/fields/FormulaReferenceWindow.island";

type AuthUser = {
  id: string;
  memberofGroupIds: string[];
};

const canReadTable = async (user: AuthUser, baseId: string, tableId: string) => {
  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId,
  });
  return gridsService.permission.hasAtLeast(gridsService.permission.resolve(grants, { baseId, tableId }), "read");
};

export default ssr<AuthContext>(async (c) => {
  c.get("page").title = "Formula reference";
  const baseSlug = c.req.param("baseId")!;
  const tableSlug = c.req.param("tableId")!;
  const base = await gridsService.base.getByIdOrShortId(baseSlug);

  if (!base) {
    return () => (
      <main class="min-h-screen bg-zinc-50 p-6 dark:bg-zinc-950">
        <div class="paper mx-auto mt-16 max-w-md p-8 text-center text-dimmed">Base not found</div>
      </main>
    );
  }

  const table = await gridsService.table.getByIdOrShortId(base.id, tableSlug);
  if (!table) {
    return () => (
      <main class="min-h-screen bg-zinc-50 p-6 dark:bg-zinc-950">
        <div class="paper mx-auto mt-16 max-w-md p-8 text-center text-dimmed">Table not found</div>
      </main>
    );
  }

  const user = currentActorUser(c);
  if (!user) {
    return () => (
      <main class="min-h-screen bg-zinc-50 p-6 dark:bg-zinc-950">
        <div class="paper mx-auto mt-16 max-w-md p-8 text-center text-dimmed">
          <i class="ti ti-lock text-sm" /> Sign in to open the formula reference.
        </div>
      </main>
    );
  }

  if (!(await canReadTable(user, base.id, table.id))) {
    return () => (
      <main class="min-h-screen bg-zinc-50 p-6 dark:bg-zinc-950">
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
