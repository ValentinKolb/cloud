import type { Dashboard } from "../contracts";
import { hasAtLeast, hasGrantsForResource, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";

export type DashboardIncludedViewer = {
  userId: string | null;
  userGroups: string[];
  serviceAccountId?: string | null;
  isAdmin?: boolean;
};

/**
 * Product policy: data rendered directly inside a dashboard is gated by
 * dashboard read access. Navigating to the source table/view/form, following
 * link widgets, or writing records still uses the origin resource's own ACL.
 */
export const canReadDashboardIncludedData = async (dashboard: Dashboard, viewer: DashboardIncludedViewer): Promise<boolean> => {
  if (viewer.isAdmin) return true;
  const grants = await loadGrantsForUser({
    userId: viewer.userId,
    userGroups: viewer.userGroups,
    serviceAccountId: viewer.serviceAccountId,
    baseId: dashboard.baseId,
    dashboardId: dashboard.id,
  });
  const level = resolveEffectivePermission(grants, { baseId: dashboard.baseId, dashboardId: dashboard.id });
  if (!hasAtLeast(level, "read")) return false;
  if (dashboard.ownerUserId === null || dashboard.ownerUserId === viewer.userId) return true;
  return hasGrantsForResource(grants, "dashboard", dashboard.id);
};
