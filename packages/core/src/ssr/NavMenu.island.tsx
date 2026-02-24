import { hasRole, type SessionUser } from "@valentinkolb/cloud-contracts/shared";
import { createSignal } from "solid-js";
import { Dropdown } from "@valentinkolb/cloud-lib/ui";
import { cookies } from "@valentinkolb/cloud-lib/browser";
import { apiClient } from "@/api/api-client";


type MobileAppLink = {
  href: string;
  iconClass: string;
  label: string;
};

type NavMenuProps = {
  user?: SessionUser;
  mobileApps: MobileAppLink[];
};

/** Navigation dropdown menu - always visible, adapts to auth state. */
export default function NavMenu(props: NavMenuProps) {
  const [theme, setTheme] = createSignal(
    typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  const [navStyle, setNavStyle] = createSignal(typeof document !== "undefined" ? (cookies.readCookie("navStyle") ?? "rail") : "rail");

  const toggleTheme = (): void => {
    const newTheme = theme() === "dark" ? "light" : "dark";
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(newTheme);
    cookies.writeCookie("theme", newTheme);
    setTheme(newTheme);
  };

  const toggleNavStyle = (): void => {
    const next = navStyle() === "tabs" ? "rail" : "tabs";
    cookies.writeCookie("navStyle", next);
    setNavStyle(next);
    // SSR-rendered layout must re-render, so reload
    location.reload();
  };

  const logout = async (): Promise<void> => {
    await apiClient.auth.logout.$post();
    window.location.href = "/auth/login";
  };

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
                  <div class="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 font-semibold text-zinc-600 dark:text-zinc-300 h-8 w-8 text-xs">
                    {(props.user.displayName || props.user.uid).slice(0, 2).toUpperCase()}
                  </div>
                  <div class="flex-1">
                    <div class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{props.user.displayName || props.user.uid}</div>
                    {props.user.displayName && hasRole(props.user, "ipa") && (
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
    // Section: Apps (mobile only — on desktop, tabs/rail handle this)
    ...(props.user
      ? [
          {
            element: (
              <div class="md:hidden">
                <div class="px-4 pt-3 pb-1 text-xs uppercase tracking-wider font-medium text-zinc-500">Apps</div>
                {props.mobileApps.map((app) => (
                  <a
                    href={app.href}
                    class="flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-white/30 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300"
                  >
                    <i class={app.iconClass} />
                    <span>{app.label}</span>
                  </a>
                ))}
                {hasRole(props.user, "admin") && (
                  <a
                    href="/admin"
                    class="flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-white/30 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300"
                  >
                    <i class="ti ti-shield-cog" />
                    <span>Admin</span>
                  </a>
                )}
              </div>
            ),
          },
        ]
      : []),
    // Section: Actions
    {
      sectionLabel: "Settings",
      items: [
        {
          icon: theme() === "dark" ? "ti ti-sunset-2" : "ti ti-moon-stars",
          label: theme() === "dark" ? "Light Mode" : "Dark Mode",
          action: toggleTheme,
        },
        ...(props.user
          ? [
              {
                icon: navStyle() === "tabs" ? "ti ti-layout-sidebar-left-collapse" : "ti ti-layout-navbar",
                label: navStyle() === "tabs" ? "Icon Rail Nav" : "Tab Bar Nav",
                action: toggleNavStyle,
              },
            ]
          : []),
        ...(props.user
          ? [
              {
                icon: "ti ti-logout",
                label: "Sign Out",
                action: logout,
                variant: "danger" as const,
              },
            ]
          : []),
      ],
    },
  ];

  return (
    <Dropdown
      trigger={
        <button type="button" class="icon-btn inline" aria-label="Menu">
          <i class="ti ti-menu-2 text-lg" />
        </button>
      }
      position="bottom-left"
      width="w-64"
      elements={getElements()}
    />
  );
}
