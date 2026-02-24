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
    <nav class="flex flex-col h-full">
      {" "}
      <div class="p-2">
        {" "}
        <div class="flex items-center gap-2 px-2 py-1.5">
          {" "}
          <i class="ti ti-settings text-sm text-dimmed" />{" "}
          <span class="text-xs font-semibold text-dimmed uppercase tracking-wider">Admin</span>{" "}
        </div>{" "}
      </div>{" "}
      <div class="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {" "}
        {adminLinks.map((link) => (
          <a href={link.href} class={`list-item text-xs ${isActive(pathname, link.href) ? "list-item-active" : ""}`}>
            {" "}
            <i class={`ti ${link.icon} text-sm`} /> <span>{link.label}</span>{" "}
          </a>
        ))}{" "}
      </div>{" "}
    </nav>
  );
}
