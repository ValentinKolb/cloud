import type { IpaHost } from "@/contracts";
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
      <table class="w-full text-xs">
        <thead>
          <tr class="border-b border-zinc-100 dark:border-zinc-800">
            <th class="px-3 py-2 text-left font-medium text-dimmed">FQDN</th>
            <th class="px-3 py-2 text-left font-medium text-dimmed">Description</th>
            <th class="px-3 py-2 text-left font-medium text-dimmed">Location</th>
            <th class="px-3 py-2 text-left font-medium text-dimmed">MAC</th>
            <th class="w-px px-3 py-2 text-right font-medium text-dimmed">
              <span class="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.hosts.map((host) => (
            <tr class="border-b border-zinc-50 hover:bg-zinc-50 last:border-0 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
              <td class="px-3 py-1.5">
                <div class="flex items-center gap-1.5">
                  <span class="max-w-[260px] truncate font-medium text-primary">{host.fqdn}</span>
                  <CopyButton text={host.fqdn} class="icon-btn h-5 w-5 text-xs text-dimmed" />
                </div>
              </td>
              <td class="max-w-[220px] truncate px-3 py-1.5 text-dimmed">{host.description || "-"}</td>
              <td class="whitespace-nowrap px-3 py-1.5 text-dimmed">{[host.locality, host.location].filter(Boolean).join(" · ") || "-"}</td>
              <td class="px-3 py-1.5">
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
              <td class="px-3 py-1.5 text-right">
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
    <div class="px-3 py-6 text-center text-xs text-dimmed">{props.emptyMessage ?? "No hosts found."}</div>
  );
};

export default HostsTable;
