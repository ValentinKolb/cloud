import type { IpaHost } from "@/ipa-hosts/contracts";
import CopyButton from "./CopyButton.island";
import EditHost from "./EditHost.island";

type Props = {
  hosts: IpaHost[];
  currentGroup?: string;
  emptyMessage?: string;
};

const HostsTable = (props: Props) => {
  return props.hosts.length > 0 ? (
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-zinc-200 bg-zinc-50/50 dark:border-zinc-700 dark:bg-zinc-800/30">
            <th class="px-4 py-2 text-left text-xs font-medium text-dimmed">FQDN</th>
            <th class="px-4 py-2 text-left text-xs font-medium text-dimmed">Description</th>
            <th class="px-4 py-2 text-left text-xs font-medium text-dimmed">Location</th>
            <th class="px-4 py-2 text-left text-xs font-medium text-dimmed">MAC</th>
            <th class="px-4 py-2 text-right text-xs font-medium text-dimmed">Actions</th>
          </tr>
        </thead>
        <tbody>
          {props.hosts.map((host) => (
            <tr class="border-b border-zinc-100 hover:bg-zinc-50 last:border-0 dark:border-zinc-800 dark:hover:bg-zinc-800/30">
              <td class="px-4 py-2">
                <div class="flex items-center gap-1.5">
                  <span class="max-w-[260px] truncate text-xs font-medium">{host.fqdn}</span>
                  <CopyButton text={host.fqdn} class="icon-btn h-5 w-5 text-xs text-dimmed" />
                </div>
              </td>
              <td class="max-w-[200px] truncate px-4 py-2 text-xs text-dimmed">{host.description || "-"}</td>
              <td class="whitespace-nowrap px-4 py-2 text-xs text-dimmed">{[host.locality, host.location].filter(Boolean).join(" · ") || "-"}</td>
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
              <td class="px-4 py-2 text-right">
                <EditHost
                  fqdn={host.fqdn}
                  description={host.description}
                  locality={host.locality}
                  location={host.location}
                  macAddress={host.macAddress}
                  memberofHostgroup={host.memberofHostgroup}
                  currentGroup={props.currentGroup}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div class="px-4 py-6 text-center text-xs text-dimmed">{props.emptyMessage ?? "No hosts found."}</div>
  );
};

export default HostsTable;
