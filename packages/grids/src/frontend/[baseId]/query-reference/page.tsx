import { hasRole } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../../config";
import { gridsService } from "../../../service";
import QueryReferenceWindow from "../../_components/query/QueryReferenceWindow.island";

type AuthUser = Parameters<typeof hasRole>[0] & {
  id: string;
  memberofGroupIds: string[];
};

const messagePage =
  (message: string, icon = "ti-alert-circle") =>
  () => (
    <main class="min-h-screen bg-zinc-50 p-6 dark:bg-zinc-950">
      <div class="paper mx-auto mt-16 max-w-md p-8 text-center text-dimmed">
        <i class={`ti ${icon} text-sm`} /> {message}
      </div>
    </main>
  );

export default ssr<AuthContext>(async (c) => {
  c.get("page").title = "Query reference";
  const baseSlug = c.req.param("baseId")!;
  const base = await gridsService.base.getByIdOrShortId(baseSlug);
  if (!base) return messagePage("Base not found");

  const user = c.get("user") as AuthUser;
  const isAdmin = hasRole(user, "admin");
  const grants = isAdmin
    ? []
    : await gridsService.permission.loadGrants({
        userId: user.id,
        userGroups: user.memberofGroupIds,
        baseId: base.id,
      });
  const baseLevel = isAdmin ? "admin" : gridsService.permission.resolve(grants, { baseId: base.id });
  if (!gridsService.permission.hasAtLeast(baseLevel, "read")) return messagePage("No access to this base", "ti-lock");

  const catalog = await gridsService.base.catalog({
    baseId: base.id,
    userId: user.id,
    userGroups: user.memberofGroupIds,
    isAdmin,
  });

  return () => (
    <QueryReferenceWindow
      baseName={base.name}
      tables={catalog.tables}
      fieldsByTable={catalog.fieldsByTable}
      viewsByTable={catalog.viewsByTable}
    />
  );
});
