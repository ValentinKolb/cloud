import { Avatar, type AvatarSize } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import type { SpaceItemAssignee } from "@/contracts";

type Props = {
  assignees: SpaceItemAssignee[];
  max?: number;
  size?: AvatarSize;
  showNames?: boolean;
  class?: string;
  avatarClass?: string;
  overflowClass?: string;
  empty?: JSX.Element;
};

const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-lg",
  xl: "h-20 w-20 text-xl",
};

export default function AssigneeAvatars(props: Props) {
  const max = () => props.max ?? 3;
  const size = () => props.size ?? "xs";
  const visible = () => props.assignees.slice(0, max());
  const hiddenCount = () => Math.max(props.assignees.length - visible().length, 0);
  const names = () => props.assignees.map((assignee) => assignee.displayName).join(", ");

  return (
    <Show when={props.assignees.length > 0} fallback={props.empty ?? null}>
      <div class={`flex min-w-0 items-center gap-2 ${props.class ?? ""}`} title={names()}>
        <div class="flex shrink-0 -space-x-1">
          <For each={visible()}>
            {(assignee) => (
              <Avatar
                username={assignee.displayName}
                userId={assignee.id}
                avatarHash={assignee.avatarHash}
                size={size()}
                class={`border-2 border-white dark:border-zinc-900 ${props.avatarClass ?? ""}`}
              />
            )}
          </For>
          <Show when={hiddenCount() > 0}>
            <span
              class={`flex shrink-0 items-center justify-center rounded-full border-2 border-white bg-zinc-300 font-medium text-zinc-700 dark:border-zinc-900 dark:bg-zinc-600 dark:text-zinc-100 ${SIZE_CLASS[size()]} ${props.overflowClass ?? ""}`}
            >
              +{hiddenCount()}
            </span>
          </Show>
        </div>
        <Show when={props.showNames}>
          <span class="min-w-0 truncate text-secondary">{names()}</span>
        </Show>
      </div>
    </Show>
  );
}
