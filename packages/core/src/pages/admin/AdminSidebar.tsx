import type { RuntimeContext } from "@/runtime";

type AdminLink = { href: string; icon: string; label: string };

const buildAdminLinks = (apps: readonly RuntimeContext["apps"][number][]): AdminLink[] => [
  { href: "/admin", icon: "ti-dashboard", label: "Overview" },
  ...apps.filter((app) => !!app.adminHref).map((app) => ({ href: app.adminHref!, icon: app.icon.replace(/^ti\s+/, ""), label: app.name })),
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname.startsWith(href);
}

export default function AdminSidebar({ pathname, apps }: { pathname: string; apps: readonly RuntimeContext["apps"][number][] }) {
  const adminLinks = buildAdminLinks(apps);

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
            {adminLinks.map((link) => (
              <a
                href={link.href}
                class={`sidebar-item-mobile ${isActive(pathname, link.href) ? "border-blue-500/35 bg-blue-50/70 text-blue-700 dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200" : ""}`}
                aria-current={isActive(pathname, link.href) ? "page" : undefined}
              >
                <i class={`ti ${link.icon}`} />
                {link.label}
              </a>
            ))}
          </div>
        </details>
      </nav>

      <aside class="sidebar-container">
        <div class="paper flex h-full min-h-0 flex-col gap-4 p-4">
          <div class="flex items-center gap-3">
            <div class="sidebar-header-icon bg-zinc-600 dark:bg-zinc-700">
              <i class="ti ti-settings text-xs" />
            </div>
            <p class="sidebar-header-title">Admin</p>
          </div>

          <div class="sidebar-body">
            <section class="sidebar-group">
              {adminLinks.map((link) => (
                <a href={link.href} class={`sidebar-item ${isActive(pathname, link.href) ? "sidebar-item-active" : ""}`}>
                  <i class={`ti ${link.icon} text-sm`} />
                  <span>{link.label}</span>
                </a>
              ))}
            </section>
          </div>
        </div>
      </aside>
    </>
  );
}
