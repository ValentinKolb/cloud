import type { BaseGroup } from "../../contracts/shared";

type GroupViewProps = {
  group: BaseGroup;
  canManage?: boolean;
};

export default function GroupView(props: GroupViewProps) {
  return (
    <div class="flex items-start gap-3 min-w-0">
      <div class="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 h-9 w-9">
        <i class="ti ti-users-group text-base" />
      </div>
      <div class="flex flex-col gap-0.5 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-primary truncate">{props.group.name}</span>
          {props.group.gidnumber && (
            <span class="tag bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 shrink-0">
              POSIX {props.group.gidnumber}
            </span>
          )}
          {props.canManage && (
            <span
              class="tag bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 shrink-0"
              title="You can manage this group"
            >
              <i class="ti ti-shield text-xs" />
              MANAGER
            </span>
          )}
        </div>
        <span class="text-xs text-dimmed truncate">{props.group.description || "No description"}</span>
      </div>
    </div>
  );
}
