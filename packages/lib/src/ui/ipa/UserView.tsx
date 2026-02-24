import { hasRole, type BaseUser } from "@valentinkolb/cloud-contracts/shared";

type UserViewProps = {
  user: BaseUser;
  showRealm?: boolean;
};

const realmStyles: Record<string, { bg: string; text: string; label: string }> = {
  ipa: {
    bg: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-700 dark:text-green-400",
    label: "IPA",
  },
  "ipa-limited": {
    bg: "bg-yellow-100 dark:bg-yellow-900/30",
    text: "text-yellow-700 dark:text-yellow-400",
    label: "IPA-Limited",
  },
  guest: {
    bg: "bg-zinc-100 dark:bg-zinc-800",
    text: "text-zinc-600 dark:text-zinc-400",
    label: "Guest",
  },
};

/** Get the primary realm role from the user's roles */
const getUserRealm = (user: BaseUser): string => {
  if (hasRole(user, "ipa")) return "ipa";
  if (hasRole(user, "ipa-limited")) return "ipa-limited";
  return "guest";
};

export default function UserView(props: UserViewProps) {
  const realmStyle = () => realmStyles[getUserRealm(props.user)] ?? realmStyles.guest;

  return (
    <div class="flex items-start gap-3 min-w-0">
      <div class="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 font-semibold text-zinc-600 dark:text-zinc-300 h-9 w-9 text-xs">
        {props.user.uid.slice(0, 2).toUpperCase()}
      </div>
      <div class="flex flex-col gap-0.5 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-primary truncate">{props.user.displayName}</span>
          {props.showRealm && realmStyle() !== undefined && (
            <span class={`tag ${realmStyle()?.bg} ${realmStyle()?.text}`}>{realmStyle()?.label}</span>
          )}
        </div>
        <div class="flex items-center gap-2 text-xs text-dimmed">
          <span class="font-mono">{hasRole(props.user, "guest") ? `${props.user.uid.slice(0, 12)}...` : props.user.uid}</span>
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
