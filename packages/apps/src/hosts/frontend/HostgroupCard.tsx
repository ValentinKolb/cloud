import type { IpaHost, IpaHostgroup } from "@/hosts/contracts";
import CopyButton from "./CopyButton.island";
import EditHost from "./EditHost.island";
import EditHostgroup from "./EditHostgroup.island";
import DeleteHostgroup from "./DeleteHostgroup.island";

type Props = {
  hostgroup: IpaHostgroup;
  hosts: IpaHost[];
  isAdmin: boolean;
};

const HostgroupCard = (props: Props) => {
  const { hostgroup, hosts, isAdmin } = props;

  return (
    <div class="paper overflow-hidden">
      {/* Header */}
      <div class="flex items-center gap-3 px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
        <i class="ti ti-folder text-lg text-blue-500 shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-sm text-primary truncate">{hostgroup.cn}</span>
            {isAdmin && <EditHostgroup cn={hostgroup.cn} description={hostgroup.description} />}
          </div>
          {hostgroup.description && <span class="text-xs text-dimmed block truncate">{hostgroup.description}</span>}
        </div>

        {/* Nested hostgroups as badges */}
        {hostgroup.hostgroups.length > 0 && (
          <div class="hidden sm:flex items-center gap-1 flex-wrap shrink-0">
            {hostgroup.hostgroups.map((nestedCn) => (
              <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                {nestedCn}
              </span>
            ))}
          </div>
        )}

        <span class="text-xs text-dimmed shrink-0 whitespace-nowrap">
          {hosts.length} {hosts.length === 1 ? "host" : "hosts"}
        </span>

        {isAdmin && <DeleteHostgroup cn={hostgroup.cn} />}
      </div>

      {/* Hosts table */}
      {hosts.length > 0 ? (
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/30">
                <th class="text-left px-4 py-2 font-medium text-dimmed text-xs">FQDN</th>
                <th class="text-left px-4 py-2 font-medium text-dimmed text-xs">Description</th>
                <th class="text-left px-4 py-2 font-medium text-dimmed text-xs">Location</th>
                <th class="text-left px-4 py-2 font-medium text-dimmed text-xs">MAC</th>
                {isAdmin && <th class="text-right px-4 py-2 font-medium text-dimmed text-xs">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {hosts.map((host) => (
                <tr class="border-b border-zinc-100 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                  <td class="px-4 py-2">
                    <div class="flex items-center gap-1.5">
                      <span class="font-medium text-xs truncate max-w-[260px]">{host.fqdn}</span>
                      <CopyButton text={host.fqdn} class="icon-btn h-5 w-5 text-xs text-dimmed" />
                    </div>
                  </td>
                  <td class="px-4 py-2 text-xs text-dimmed max-w-[200px] truncate">{host.description || "-"}</td>
                  <td class="px-4 py-2 text-xs text-dimmed whitespace-nowrap">
                    {[host.locality, host.location].filter(Boolean).join(" · ") || "-"}
                  </td>
                  <td class="px-4 py-2">
                    {host.macAddress.length > 0 ? (
                      <div class="flex flex-col gap-0.5">
                        {host.macAddress.map((mac) => (
                          <div class="flex items-center gap-1.5">
                            <span class="text-xs font-mono text-dimmed">{mac}</span>
                            <CopyButton text={mac} class="icon-btn h-5 w-5 text-xs text-dimmed" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span class="text-xs text-dimmed">-</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td class="px-4 py-2 text-right">
                      <EditHost
                        fqdn={host.fqdn}
                        description={host.description}
                        locality={host.locality}
                        location={host.location}
                        memberofHostgroup={host.memberofHostgroup}
                        currentGroup={hostgroup.cn}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div class="px-4 py-6 text-center text-xs text-dimmed">No hosts in this group.</div>
      )}
    </div>
  );
};

export default HostgroupCard;
