import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { hasRole } from "@/hosts/contracts";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import NewHostgroup from "./NewHostgroup.island";
import HostgroupCard from "./HostgroupCard";
import { hostsService } from "../service";

export default ssr<AuthContext>(async (c) => {
  const sessionUser = c.get("user");
  const isAdmin = hasRole(sessionUser, "admin");
  const search = c.req.query("search") ?? "";

  const hostgroupsPage = await hostsService.hostgroup.list({
    pagination: { perPage: 9999 },
    filter: { query: search || undefined },
  });
  const hostgroups = hostgroupsPage.items;
  const total = hostgroupsPage.total;

  const hostsPerGroup = await Promise.all(
    hostgroups.map((hg) =>
      hostsService.host.listByGroup({
        hostgroupCn: hg.cn,
        pagination: { perPage: 9999 },
      }),
    ),
  );

  return (
    <AdminLayout c={c} title="Hosts">
      <div class="max-w-6xl mx-auto flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h1 class="text-lg font-semibold text-primary">Hosts</h1>
            <p class="text-xs text-dimmed">
              {total} {total === 1 ? "hostgroup" : "hostgroups"}
            </p>
          </div>
          {isAdmin && <NewHostgroup />}
        </div>

        <SearchBar placeholder="Search hostgroups..." ariaLabel="Search hostgroups" />

        {hostgroups.length > 0 ? (
          hostgroups.map((hg, i) => <HostgroupCard hostgroup={hg} hosts={hostsPerGroup[i]!.items} isAdmin={isAdmin} />)
        ) : (
          <div class="paper p-6 text-center text-sm text-dimmed">
            {search ? `No hostgroups matching "${search}".` : "No hostgroups yet."}
          </div>
        )}
      </div>
    </AdminLayout>
  );
});
