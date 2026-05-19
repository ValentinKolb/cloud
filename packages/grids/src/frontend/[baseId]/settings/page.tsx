import { hasRole } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../../config";
import { gridsService } from "../../../service";
import BaseSettingsPanel from "../../_components/settings/BaseSettingsPanel.island";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const baseShortId = c.req.param("baseId")!;

  const base = await gridsService.base.getByIdOrShortId(baseShortId);
  if (!base) {
    return () => (
      <Layout c={c} title="Not found">
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class="ti ti-alert-circle text-sm" /> Base not found
        </div>
      </Layout>
    );
  }
  const baseId = base.id;

  // Permission gate. Admin shortcuts past the per-base ACL like the rest of
  // grids; otherwise we resolve the level on the base and require admin.
  const level = hasRole(user, "admin")
    ? ("admin" as const)
    : gridsService.permission.resolve(
        await gridsService.permission.loadGrants({
          userId: user.id,
          userGroups: user.memberofGroupIds,
          baseId,
          tableId: null,
        }),
        { baseId },
      );
  if (!gridsService.permission.hasAtLeast(level, "admin")) {
    return c.redirect(`/app/grids/${baseShortId}`, 302);
  }

  const accessEntries = await gridsService.access.listForBase(baseId);
  // Pre-fetch dashboards for the default-dashboard select. Listing as
  // the (just-confirmed admin) user — admins see every dashboard, so
  // the select isn't restricted by personal-dashboard ownership.
  const dashboards = await gridsService.dashboard.listForBase({
    baseId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });

  return () => (
    <Layout
      c={c}
      title={[
        { title: "Start", href: "/" },
        { title: "Grids", href: "/app/grids" },
        { title: base.name, href: `/app/grids/${baseShortId}` },
        { title: "Settings" },
      ]}
    >
      <div class="max-w-xl mx-auto w-full py-6 px-4">
        <BaseSettingsPanel base={base} accessEntries={accessEntries} dashboards={dashboards} />
      </div>
    </Layout>
  );
});
