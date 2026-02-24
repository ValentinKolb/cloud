import { ssr } from "@config";
import { type AuthContext } from "@valentinkolb/cloud-lib/server/middleware/auth";
import AdminLayout from "./AdminLayout";
import { LinkCard } from "@valentinkolb/cloud-lib/ui";
import { getRuntimeContext } from "@/runtime";
import { resolveAppColor } from "@valentinkolb/cloud-contracts/app";

export default ssr<AuthContext>(async (c) => {
  const adminApps = getRuntimeContext(c).apps.filter((app) => !!app.adminHref);

  return (
    <AdminLayout c={c} title="Overview">
      <div class="max-w-6xl mx-auto">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {adminApps.map((app) => (
            <LinkCard
              href={app.adminHref!}
              title={app.name}
              description={app.description}
              icon={app.icon}
              color={resolveAppColor(app.color)}
            />
          ))}
        </div>
      </div>
    </AdminLayout>
  );
});
