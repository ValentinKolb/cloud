import type { BaseUser } from "@valentinkolb/cloud-contracts/shared";

type UserViewProps = {
  user: BaseUser;
  showRealm?: boolean;
};

const badgeStyles: Record<`${"ipa" | "local"}:${"user" | "guest"}`, { bg: string; text: string; label: string }> = {
  "ipa:user": {
    bg: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-700 dark:text-green-400",
    label: "IPA",
  },
  "ipa:guest": {
    bg: "bg-yellow-100 dark:bg-yellow-900/30",
    text: "text-yellow-700 dark:text-yellow-400",
    label: "IPA Guest",
  },
  "local:user": {
    bg: "bg-sky-100 dark:bg-sky-900/30",
    text: "text-sky-700 dark:text-sky-400",
    label: "Local",
  },
  "local:guest": {
    bg: "bg-zinc-100 dark:bg-zinc-800",
    text: "text-zinc-600 dark:text-zinc-400",
    label: "Guest",
  },
};

export default function UserView(props: UserViewProps) {
  const badge = () => badgeStyles[`${props.user.provider}:${props.user.profile}`] ?? badgeStyles["local:guest"];

  return (
    <div class="flex items-start gap-3 min-w-0">
      <div class="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 font-semibold text-zinc-600 dark:text-zinc-300 h-9 w-9 text-xs">
        {props.user.uid.slice(0, 2).toUpperCase()}
      </div>
      <div class="flex flex-col gap-0.5 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-primary truncate">{props.user.displayName}</span>
          {props.showRealm && badge() !== undefined && (
            <span class={`tag ${badge()?.bg} ${badge()?.text}`}>{badge()?.label}</span>
          )}
        </div>
        <div class="flex items-center gap-2 text-xs text-dimmed">
          <span class="font-mono">{props.user.profile === "guest" ? `${props.user.uid.slice(0, 12)}...` : props.user.uid}</span>
          {props.user.mail && (
            <>
              <span class="text-zinc-300 dark:text-zinc-600">|</span>
              <span class="truncate">{props.user.mail}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
