import { ssr } from "../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { LinkCard, StatCell } from "@valentinkolb/cloud/ui";
import { getRuntimeContext } from "@valentinkolb/cloud/ssr";

export default ssr<AuthContext>(async (c) => {
  const allApps = getRuntimeContext(c).apps;
  const adminApps = allApps.filter((app) => !!app.adminHref);
  const appsWithNav = allApps.filter((a) => a.nav);

  return () => (
    <AdminLayout c={c} title="Overview">
      <div class="max-w-6xl mx-auto">
        {/* Stat cards — see skills/cloud-app/references/frontend.md § Stats */}
        <div class="paper overflow-hidden mb-2">
          <div class="grid grid-cols-3 gap-px p-px bg-zinc-100 dark:bg-zinc-800">
            <StatCell
              label="Apps"
              value={allApps.length}
              sub="registered"
              accent={{ tone: "blue", icon: "ti ti-stack-3" }}
            />
            {/* Admin panels — anchor-pill, must stay inline (StatCell only renders span tags) */}
            <div class="bg-white dark:bg-zinc-900 px-4 py-4 flex flex-col gap-0.5">
              <span class="text-[10px] uppercase tracking-wider text-dimmed">Admin panels</span>
              <span class="text-xl font-bold tabular-nums text-primary">{adminApps.length}</span>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] text-dimmed">manageable</span>
                <a href="/admin/gateway" class="tag bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors">
                  <i class="ti ti-shield text-[9px]" />gateway
                </a>
              </div>
            </div>
            <StatCell
              label="Navigation"
              value={appsWithNav.length}
              sub="visible to users"
              accent={{ tone: "blue", icon: "ti ti-eye" }}
            />
          </div>
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
