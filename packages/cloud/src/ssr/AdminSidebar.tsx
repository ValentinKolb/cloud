import type { RuntimeContext } from "./runtime";

type AdminLink = { href: string; icon: string; label: string };
type AdminGroup = { label: string; links: AdminLink[] };

const settingsLinks: AdminLink[] = [
  { href: "/admin/settings?tab=general", icon: "ti-app-window", label: "General" },
  { href: "/admin/settings?tab=user", icon: "ti-users", label: "User Management" },
  { href: "/admin/settings?tab=freeipa", icon: "ti-building-fortress", label: "FreeIPA" },
  { href: "/admin/settings?tab=mail", icon: "ti-mail", label: "Mail" },
  { href: "/admin/settings?tab=security", icon: "ti-shield-lock", label: "Security" },
  { href: "/admin/settings?tab=legal", icon: "ti-file-text", label: "Legal" },
];

const staticGroups: AdminGroup[] = [
  {
    label: "Gateway",
    links: [
      { href: "/admin/gateway/apps", icon: "ti-apps", label: "Apps" },
      { href: "/admin/gateway/routes", icon: "ti-route", label: "Routes" },
    ],
  },
  {
    label: "Observability",
    links: [
      { href: "/admin/observability/logs", icon: "ti-list-details", label: "Logs" },
      { href: "/admin/observability/telemetry", icon: "ti-chart-line", label: "Telemetry" },
      { href: "/admin/observability/postgres", icon: "ti-database", label: "Postgres" },
      { href: "/admin/observability/redis", icon: "ti-database", label: "Redis" },
      { href: "/admin/observability/alerts", icon: "ti-webhook", label: "Webhooks" },
      { href: "/admin/observability/notifications", icon: "ti-bell", label: "Notifications" },
    ],
  },
  { label: "Settings", links: settingsLinks },
];

const consoleAdminHrefs = new Set([
  "/admin/gateway",
  "/admin/gateway/apps",
  "/admin/gateway/routes",
  "/admin/observability/logs",
  "/admin/observability/telemetry",
  "/admin/observability/data",
  "/admin/observability/postgres",
  "/admin/observability/redis",
  "/admin/observability/alerts",
  "/admin/observability/notifications",
  "/admin/settings",
]);

const buildAdminGroups = (apps: readonly RuntimeContext["apps"][number][]): AdminGroup[] => {
  const appLinks = apps
    .filter((app) => !!app.adminHref && !consoleAdminHrefs.has(app.adminHref))
    .map((app) => ({
      href: app.adminHref!,
      icon: app.icon.replace(/^ti\s+/, ""),
      label: app.name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    {
      label: "General",
      links: [
        { href: "/admin", icon: "ti-dashboard", label: "Overview" },
        { href: "/admin/announcements", icon: "ti-speakerphone", label: "Announcements" },
      ],
    },
    ...staticGroups,
    ...(appLinks.length > 0 ? [{ label: "App Admin", links: appLinks }] : []),
  ];
};

function isActive(currentPath: string, href: string): boolean {
  const current = new URL(`http://admin.local${currentPath}`);
  const target = new URL(`http://admin.local${href}`);
  if (target.pathname === "/admin") return current.pathname === "/admin";
  if (target.pathname === "/admin/settings") {
    return current.pathname === "/admin/settings" && current.searchParams.get("tab") === target.searchParams.get("tab");
  }
  return current.pathname === target.pathname || current.pathname.startsWith(`${target.pathname}/`);
}

const MobileLink = (props: { currentPath: string; link: AdminLink }) => (
  <a
    href={props.link.href}
    class={`sidebar-item-mobile ${
      isActive(props.currentPath, props.link.href)
        ? "border-blue-500/35 bg-blue-50/70 text-blue-700 dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200"
        : ""
    }`}
    aria-current={isActive(props.currentPath, props.link.href) ? "page" : undefined}
  >
    <i class={`ti ${props.link.icon}`} />
    {props.link.label}
  </a>
);

const DesktopLink = (props: { currentPath: string; link: AdminLink }) => (
  <a href={props.link.href} class={`sidebar-item ${isActive(props.currentPath, props.link.href) ? "sidebar-item-active" : ""}`}>
    <i class={`ti ${props.link.icon} text-sm`} />
    <span>{props.link.label}</span>
  </a>
);

export default function AdminSidebar({ currentPath, apps }: { currentPath: string; apps: readonly RuntimeContext["apps"][number][] }) {
  const groups = buildAdminGroups(apps);

  return (
    <>
      <nav class="sidebar-container-mobile">
        <details class="group">
          <summary class="sidebar-mobile-toggle">
            <div class="w-8 h-8 rounded-lg bg-zinc-600 text-white grid place-items-center shrink-0 dark:bg-zinc-700">
              <i class="ti ti-settings text-sm" />
            </div>
            <span class="font-semibold truncate flex-1">Admin</span>
            <span class="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed transition-transform group-open:rotate-180">
              <i class="ti ti-chevron-down text-sm" />
            </span>
          </summary>
          <div class="sidebar-mobile-actions">
            {groups.map((group) => (
              <section class="sidebar-group">
                <p class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-dimmed">{group.label}</p>
                {group.links.map((link) => (
                  <MobileLink currentPath={currentPath} link={link} />
                ))}
              </section>
            ))}
          </div>
        </details>
      </nav>

      <aside class="sidebar-container">
        <div class="paper flex h-full min-h-0 flex-col gap-4 p-3">
          <div class="flex items-center gap-3">
            <div class="sidebar-header-icon bg-zinc-600 dark:bg-zinc-700">
              <i class="ti ti-settings text-xs" />
            </div>
            <p class="sidebar-header-title">Admin</p>
          </div>

          <div class="sidebar-body">
            {groups.map((group) => (
              <section class="sidebar-group">
                <p class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-dimmed">{group.label}</p>
                {group.links.map((link) => (
                  <DesktopLink currentPath={currentPath} link={link} />
                ))}
              </section>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
