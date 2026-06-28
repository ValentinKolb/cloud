import type { Role } from "../contracts/shared";
import { Avatar, Dropdown } from "../ui";

/**
 * Minimal user projection for the nav menu — covers exactly what's rendered
 * (initials, display name, uid, profile flag, admin role check). Avoids
 * serializing the full `User` (incl. mail, ssh keys, phone, address, group
 * memberships) into HTML `data-props` on every authenticated page.
 */
export type NavMenuUser = {
  id: string;
  uid: string;
  displayName: string;
  profile: string;
  roles: Role[];
  avatarHash: string | null;
};

type NavMenuProps = {
  user?: NavMenuUser;
};

/** Navigation dropdown menu - always visible, adapts to auth state. */
export default function NavMenu(props: NavMenuProps) {
  const getElements = () => [
    // Top: Profile or Login
    ...(props.user
      ? [
          {
            element: (
              <a
                href="/me"
                class="flex border-b border-zinc-200 p-4 dark:border-zinc-800 transition-colors hover:bg-white/30 dark:hover:bg-white/10"
              >
                <div class="flex items-center gap-3">
                  <Avatar
                    username={props.user.displayName || props.user.uid}
                    userId={props.user.id}
                    avatarHash={props.user.avatarHash}
                    size="sm"
                  />
                  <div class="flex-1">
                    <div class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{props.user.displayName || props.user.uid}</div>
                    {props.user.displayName && props.user.profile !== "guest" && (
                      <div class="hidden sm:block text-xs text-dimmed">{props.user.uid}</div>
                    )}
                  </div>
                </div>
              </a>
            ),
          },
        ]
      : [
          {
            icon: "ti ti-login",
            label: "Sign In",
            href: "/auth/login",
          },
        ]),
  ];

  return (
    <Dropdown
      trigger={
        <button type="button" class="icon-btn inline items-center justify-center" aria-label="Menu">
          <i class="ti ti-menu-2 text-lg" />
        </button>
      }
      position="bottom-left"
      width="w-64"
      elements={getElements()}
    />
  );
}
