import { normalizeRedirectTo } from "../shared";
import type { RuntimeContext } from "./runtime";

export type AdminLink = { href: string; icon: string; label: string };
export type AdminGroup = { label: string; links: AdminLink[] };

const settingsLinks: AdminLink[] = [
  { href: "/admin/settings?tab=general", icon: "ti-app-window", label: "General" },
  { href: "/admin/settings?tab=user", icon: "ti-users", label: "User Management" },
  { href: "/admin/settings?tab=freeipa", icon: "ti-building-fortress", label: "FreeIPA" },
  { href: "/admin/settings?tab=mail", icon: "ti-mail", label: "Mail" },
  { href: "/admin/settings?tab=pdf-rendering", icon: "ti-file-type-pdf", label: "PDF Rendering" },
  { href: "/admin/settings?tab=email-templates", icon: "ti-template", label: "Email Templates" },
  { href: "/admin/settings?tab=security", icon: "ti-shield-lock", label: "Security" },
  { href: "/admin/settings?tab=legal", icon: "ti-file-text", label: "Legal" },
];

const aiLinks: AdminLink[] = [
  { href: "/admin/settings?tab=ai-general", icon: "ti-adjustments", label: "General" },
  { href: "/admin/settings?tab=ai-providers", icon: "ti-sparkles", label: "Providers" },
  { href: "/admin/settings?tab=ai-skills", icon: "ti-wand", label: "Skills" },
  { href: "/admin/settings?tab=ai-jobs", icon: "ti-activity", label: "Background Jobs" },
];

const normalizeAdminHref = (href: string | undefined): string | undefined => {
  const normalized = normalizeRedirectTo(href);
  return normalized === "/admin" || normalized?.startsWith("/admin/") ? normalized : undefined;
};

export const buildAdminGroups = (apps: readonly RuntimeContext["apps"][number][]): AdminGroup[] => {
  const contributedApps = apps
    .map((app) => ({
      app,
      groups: (app.adminNav ?? [])
        .map((group) => ({
          label: group.label,
          links: group.links.flatMap((link) => {
            const href = normalizeAdminHref(link.href);
            return href ? [{ href, icon: link.icon.replace(/^ti\s+/, ""), label: link.label }] : [];
          }),
        }))
        .filter((group) => group.links.length > 0),
    }))
    .sort((a, b) => a.app.name.localeCompare(b.app.name));

  const appsWithGroups = new Set(contributedApps.filter(({ groups }) => groups.length > 0).map(({ app }) => app.id));
  const appLinks = apps
    .filter((app) => !appsWithGroups.has(app.id))
    .flatMap((app) => {
      const href = normalizeAdminHref(app.adminHref);
      return href ? [{ href, icon: app.icon.replace(/^ti\s+/, ""), label: app.name }] : [];
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    {
      label: "General",
      links: [
        { href: "/admin", icon: "ti-dashboard", label: "Overview" },
        { href: "/admin/announcements", icon: "ti-speakerphone", label: "Announcements" },
      ],
    },
    ...contributedApps.flatMap(({ groups }) => groups),
    { label: "AI", links: aiLinks },
    { label: "Settings", links: settingsLinks },
    ...(appLinks.length > 0 ? [{ label: "App Admin", links: appLinks }] : []),
  ];
};
