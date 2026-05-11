import { ssr } from "../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { LinkCard, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { getRuntimeContext } from "@valentinkolb/cloud/ssr";

export default ssr<AuthContext>(async (c) => {
  const allApps = getRuntimeContext(c).apps;
  const adminApps = allApps.filter((app) => !!app.adminHref);
  const appsWithNav = allApps.filter((a) => a.nav);

  return () => (
    <AdminLayout c={c} title="Overview">
      <div class="max-w-6xl mx-auto">
        {/* Stat cards — see skills/cloud-app/references/frontend.md § Stats */}
        <div class="mb-2">
          <StatGrid columns={3}>
            <StatCell
              label="Apps"
              value={allApps.length}
              sub="registered"
              accent={{ tone: "blue", icon: "ti ti-stack-3" }}
            />
            <StatCell
              label="Admin panels"
              value={adminApps.length}
              sub="manageable"
              accent={{
                tone: "blue",
                icon: "ti ti-shield",
                text: "gateway",
                href: "/admin/gateway",
              }}
            />
            <StatCell
              label="Navigation"
              value={appsWithNav.length}
              sub="visible to users"
              accent={{ tone: "blue", icon: "ti ti-eye" }}
            />
          </StatGrid>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {adminApps.map((app) => (
            <LinkCard
              href={app.adminHref!}
              title={app.name}
              description={app.description}
              icon={app.icon}
              color="zinc"
            />
          ))}
        </div>
      </div>
    </AdminLayout>
  );
});
