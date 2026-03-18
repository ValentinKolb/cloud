import type { IpaHost, IpaHostgroup } from "@/ipa-hosts/contracts";
import EditHostgroup from "./EditHostgroup.island";
import DeleteHostgroup from "./DeleteHostgroup.island";
import HostsTable from "./HostsTable";

type Props = {
  hostgroup: IpaHostgroup;
  hosts: IpaHost[];
};

const HostgroupCard = (props: Props) => {
  const { hostgroup, hosts } = props;

  return (
    <div class="paper overflow-hidden">
      {/* Header */}
      <div class="flex items-center gap-3 px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
        <i class="ti ti-folder text-lg text-blue-500 shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-sm text-primary truncate">{hostgroup.cn}</span>
            <EditHostgroup cn={hostgroup.cn} description={hostgroup.description} />
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

        <DeleteHostgroup cn={hostgroup.cn} />
      </div>

      <HostsTable hosts={hosts} currentGroup={hostgroup.cn} emptyMessage="No hosts in this group." />
    </div>
  );
};

export default HostgroupCard;
