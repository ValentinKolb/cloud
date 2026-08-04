import { Avatar, Dropdown, IconButton, type DropdownItem } from "@k2b/ui";
import type { Role } from "../contracts/shared";

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
  const avatarName = () => props.user?.displayName || props.user?.uid || "?";
  const avatarSrc = () =>
    props.user?.id && props.user.avatarHash
      ? `/api/accounts/users/${encodeURIComponent(props.user.id)}/avatar?rev=${encodeURIComponent(props.user.avatarHash)}`
      : undefined;

  const getElements = (): DropdownItem[] => [
    // Top: Profile or Login
    ...(props.user
      ? [
          {
            element: (
              <a href="/me" role="menuitem" tabIndex={-1} class="k2b-dropdown__item">
                <div class="flex items-center gap-3">
                  <Avatar name={avatarName()} src={avatarSrc()} fallback={avatarName().slice(0, 2).toUpperCase()} size="sm" />
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
        <IconButton label="Menu">
          <i class="ti ti-menu-2 text-lg" />
        </IconButton>
      }
      position="bottom-left"
      width="16rem"
      elements={getElements()}
    />
  );
}
