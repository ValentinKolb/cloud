import { hasRole, type User } from "../contracts/shared";
import type { JSX } from "solid-js/jsx-runtime";
import NavMenu from "./NavMenu.island";
import ThemeToggleRail from "./ThemeToggleRail.island";
import HotkeysHelpRail from "./HotkeysHelpRail.island";
import GlobalSearchTrigger from "./GlobalSearchTrigger.island";
import Footer from "./Footer.island";
import TimezoneCookie from "./TimezoneCookie.island";
import LayoutBreadcrumbs from "./LayoutBreadcrumbs.island";
import AppLaunchpad, { type AppLaunchpadApp } from "./AppLaunchpad.island";
import { dates } from "../shared";
import { getRuntimeContext, type RuntimeContext } from "./runtime";
import { resolveNavMatch } from "../contracts/app"; // ==========================
import type { GlobalSearchHelpApp } from "./GlobalSearchHelpDialog";
import type { LayoutBreadcrumb } from "../ui/layout";
// Types
type Breadcrumb = LayoutBreadcrumb;
type AppLink = { id: string; iconClass: string; label: string; href: string; match: string; description?: string };
type LayoutContext = {
  get(key: "user"): User | undefined;
  get(key: "page"): { theme?: "light" | "dark" };
  get(key: "runtime"): RuntimeContext;
  /**
   * Per-request settings snapshot (populated by snapshot middleware in
   * `_internal/define-app.ts`). Loose-typed at this layer so Layout can be
   * shared across apps with different SettingsMaps; reading core keys like
   * `app.name`/`app.copyright` is safe because every container's snapshot
   * includes core's keys.
   */
  get(key: "settings"): Record<string, any>;
  req: { raw: { headers: Headers; url: string } };
};
type LayoutProps = {
  children: JSX.Element;
  c: LayoutContext;
  title?: string | Breadcrumb[];
  fullPage?: boolean /** Remove main padding for fullwidth app layouts */;
  fullWidth?: boolean;
}; // ==========================
// Helpers
function active(pathname: string, match: string): string {
  return pathname.startsWith(match) ? "active" : "";
}
const jsonScript = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c");

function buildNavLinks(apps: RuntimeContext["apps"], user: User | undefined): { primary: AppLink[]; more: AppLink[] } {
  const links = apps
    .filter((app) => !!app.nav && app.nav.section !== "hidden")
    .filter((app) => {
      if (app.nav?.requiresAuth && !user) return false;
      if (
        app.nav?.requiresRoles &&
        (!user ||
          !app.nav.requiresRoles.some((role) => {
            if (role === "guest") return user.profile === "guest";
            return hasRole(user, role);
          }))
      ) {
        return false;
      }
      return true;
    })
    .map((app) => ({
      section: app.nav!.section,
      link: {
        iconClass: app.icon,
        id: app.id,
        label: app.name,
        href: app.nav!.href,
        match: resolveNavMatch(app) ?? app.nav!.href.split("?")[0] ?? app.nav!.href,
        description: app.description,
      } satisfies AppLink,
    }));
  const primary = links.filter((entry) => entry.section === "primary").map((entry) => entry.link);
  const more = links.filter((entry) => entry.section === "more").map((entry) => entry.link);
  if (user && hasRole(user, "admin")) {
    more.push({ id: "admin", iconClass: "ti ti-settings", label: "Admin", href: "/admin", match: "/admin", description: "Platform administration." });
  }
  return { primary, more };
} // ==========================
// Warning Components
const WARN_DAYS = 14;
function ProfileWarnings({ user }: { user: User }) {
  if (user.profile === "guest") return null;
  const missing: string[] = [];
  if (!user.displayName) missing.push("display name");
  if (!user.givenname) missing.push("first name");
  if (!user.sn) missing.push("last name");
  if (missing.length === 0) return null;
  return (
      <a href="/me" class="flex items-center gap-2 text-xs info-block-warning no-underline mb-2 md:mb-1.5 mx-2 md:ml-0 md:mr-1.5">
        <i class="ti ti-user-exclamation" /> <span>Your profile is incomplete: {missing.join(",")} not set.</span>
      </a>
  );
}
function ExpiryWarnings({ user }: { user: User }) {
  const now = Date.now();
  const warnThreshold = now + WARN_DAYS * 24 * 60 * 60 * 1000;
  const warnings: { icon: string; message: string; expired: boolean }[] = [];
  if (user.accountExpires) {
    const expires = new Date(user.accountExpires).getTime();
    const accountLabel = user.provider === "ipa" ? "account" : user.profile === "guest" ? "guest account" : "account";
    if (expires < now) warnings.push({ icon: "ti-calendar-event", message: "Your account has expired.", expired: true });
    else if (expires < warnThreshold)
      warnings.push({
        icon: "ti-calendar-event",
        message: `Your ${accountLabel} expires on ${dates.formatDate(user.accountExpires)}.`,
        expired: false,
      });
  }
  if (user.ipa?.passwordExpires) {
    const expires = new Date(user.ipa.passwordExpires).getTime();
    if (expires < now)
      warnings.push({ icon: "ti-key", message: "Your password has expired. Please log out and in again to change it.", expired: true });
    else if (expires < warnThreshold)
      warnings.push({ icon: "ti-key", message: `Your password expires on ${dates.formatDate(user.ipa.passwordExpires)}.`, expired: false });
  }
  if (warnings.length === 0) return null;
  return (
    <div class="flex flex-col gap-1 px-2">
      {" "}
      {warnings.map((w) => (
        <div class={`flex items-center gap-2 text-xs ${w.expired ? "info-block-danger" : "info-block-warning"}`}>
          {" "}
          <i class={`ti ${w.icon}`} /> <span>{w.message}</span>{" "}
        </div>
      ))}{" "}
    </div>
  );
} // ==========================
// Sub-Components
// ==========================
// Main Layout
export default function Layout({ children, c, title, fullPage, fullWidth }: LayoutProps) {
  const runtime = getRuntimeContext(c);
  const cookie = c.req.raw.headers.get("Cookie") ?? "";
  const themeMatch = cookie.match(/theme=([^;]+)/);
  c.get("page").theme = themeMatch?.[1] === "dark" ? "dark" : "light";
  const user = c.get("user");
  const pathname = new URL(c.req.raw.url).pathname;
  const { primary: primaryApps, more: moreApps } = buildNavLinks(runtime.apps, user);
  const allApps = [...primaryApps, ...moreApps];
  const launchpadApps: AppLaunchpadApp[] = allApps.map((app) => ({
    id: app.id,
    iconClass: app.iconClass,
    label: app.label,
    href: app.href,
    description: app.description,
  }));
  const searchHelpApps: GlobalSearchHelpApp[] = runtime.apps
    .filter((app) => (app.searchTags?.length ?? 0) > 0)
    .map((app) => ({
      appId: app.id,
      appName: app.name,
      appIcon: app.icon,
      help: app.searchHelp,
      tags: [...new Set((app.searchTags ?? []).map((tag) => tag.toLowerCase()))],
      tagHelp: [...(app.searchTagHelp ?? [])],
    }))
    .sort((a, b) => a.appName.localeCompare(b.appName));
  const settings = c.get("settings");
  const appName = settings?.app?.name || "Cloud";
  // Project the user record down to what NavMenu actually renders. Without
  // this, the full `User` (mail, ssh keys, phone, address, all group
  // memberships) gets serialized into the island's data-props HTML on every
  // authenticated page — defense-in-depth.
  const navMenuUser = user
    ? {
        uid: user.uid,
        displayName: user.displayName,
        profile: user.profile,
        roles: user.roles,
      }
    : undefined;
  // Aggregate legalLinks from every running app (last-wins on duplicate href).
  const legalLinks = (() => {
    const seen = new Map<string, { label: string; href: string; icon?: string }>();
    if (user) seen.set("/me", { label: "Profile", href: "/me", icon: "ti ti-user-circle" });
    for (const app of runtime.apps) {
      for (const link of app.legalLinks ?? []) seen.set(link.href, { ...link });
    }
    return [...seen.values()];
  })();
  const page = c.get("page") as Record<string, unknown>;
  const pageTitle = typeof title === "string" ? title : (title?.at(-1)?.title ?? appName);
  if (!page.title) page.title = pageTitle;
  const breadcrumbs: Breadcrumb[] = !title ? [{ title: appName }] : typeof title === "string" ? [{ title }] : title;
  const showRail =
    !!user; /* * Grid layout: * Rail mode: [rail | content] * No rail: [content] * * Rows: [header] [main] [footer?] * The rail spans rows 1+2 via grid-row, so logo aligns with the header. */
  const contentPadding = "p-2.5 md:p-0 md:pr-2 md:pb-2";
  const gridClass = showRail
    ? "grid-cols-1 md:grid-cols-[auto_1fr] grid-rows-[auto_1fr]"
    : `grid-cols-1 ${!fullPage ? "grid-rows-[auto_1fr_auto]" : "grid-rows-[auto_1fr]"}`;
  return (
    <div
      class={`grid min-h-screen w-screen relative md:h-screen md:overflow-hidden bg-zinc-50 dark:bg-zinc-950 ${gridClass}`}
    >
      <TimezoneCookie />
      {showRail && <AppLaunchpad apps={launchpadApps} legalLinks={legalLinks} />}
      {showRail && <script id="cloud-app-launchpad-data" type="application/json">{jsonScript({ apps: launchpadApps, legalLinks })}</script>}
      {" "}
      {/* ── Rail: logo cell (row 1, col 1) — grid gives it the same height as the header ── */}{" "}
      {showRail && (
        <div class="hidden md:flex items-center justify-center w-12 bg-white/20 dark:bg-zinc-950/20">
          {" "}
          <a href="/" aria-label="Home">
            {" "}
            <img src="/branding/logo" alt="Logo" class="h-5 w-5" />{" "}
          </a>{" "}
        </div>
      )}{" "}
      {/* ── Header (row 1) ── */}{" "}
      <header
        class="flex justify-between items-center m-2 md:ml-0 md:m-1.5 py-1.5 md:py-2 px-2 md:px-3 paper"
        style="box-shadow: var(--theme-shadow-elevated)"
      >
        {" "}
        <div class="flex items-center gap-2 min-w-0">
          {" "}
          {/* Logo — only when no rail */}{" "}
          {!showRail && (
            <a href="/" class="shrink-0 flex items-center" aria-label="Home">
              {" "}
              <img src="/branding/logo" alt="Logo" class="h-6 w-6" />{" "}
            </a>
          )}{" "}
          {showRail && (
            <a
              href="/"
              aria-label="Home"
              class="md:hidden inline-flex items-center justify-center w-8 h-8 rounded-lg text-dimmed hover:text-secondary hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <img src="/branding/logo" alt="Home" class="h-4 w-4" />
            </a>
          )}{" "}
          {/* Breadcrumbs — desktop, rail mode only */}{" "}
          <div class="hidden md:flex items-center min-w-0">
            {" "}
            <LayoutBreadcrumbs breadcrumbs={breadcrumbs} />{" "}
          </div>{" "}
          {/* Mobile breadcrumb */}{" "}
          <div class="md:hidden flex items-center min-w-0">
            {" "}
            <LayoutBreadcrumbs breadcrumbs={breadcrumbs} mobile />{" "}
          </div>{" "}
        </div>{" "}
        <div class="flex items-center shrink-0 gap-1">
          {user && (
            <GlobalSearchTrigger
              variant="header"
              registerHotkey
              class={showRail ? "md:hidden" : ""}
              searchHelpApps={searchHelpApps}
            />
          )}
          {" "}
          {/* Desktop: direct /me link with avatar (logged in) or NavMenu (not logged in) */}{" "}
          {user ? (
            <>
              {" "}
              <a href="/me" class="hidden md:flex items-center justify-center cursor-pointer" aria-label="Profile">
                {" "}
                <span class="inline-flex items-center justify-center w-6 h-6 text-[9px] font-semibold rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                  {" "}
                  {(user.displayName || user.uid).slice(0, 2).toUpperCase()}{" "}
                </span>{" "}
              </a>{" "}
              <div class="md:hidden">
                {" "}
                <div class="flex items-center gap-1">
                  <AppLaunchpad apps={launchpadApps} legalLinks={legalLinks} variant="header" label="Open apps" />
                </div>{" "}
              </div>{" "}
            </>
          ) : (
            <NavMenu user={navMenuUser} />
          )}{" "}
        </div>{" "}
      </header>{" "}
      {/* ── Rail: apps cell (row 2, col 1) ── */}{" "}
      {showRail && (
        <div class="hidden md:flex flex-col items-center w-12 gap-1 pt-1 bg-white/20 dark:bg-zinc-950/20">
          {" "}
          {primaryApps.map((app) => (
            <a href={app.href} class={`rail-item ${active(pathname, app.match) ? "rail-item-active" : ""}`} title={app.label}>
              {" "}
              <i class={`${app.iconClass} text-base`} />{" "}
            </a>
          ))}{" "}
          <AppLaunchpad apps={launchpadApps} legalLinks={legalLinks} variant="rail" label="Open apps" />
          <div class="mt-auto pb-1 flex flex-col items-center gap-1">
            {" "}
            <GlobalSearchTrigger variant="rail" searchHelpApps={searchHelpApps} />{" "}
            {" "}
            <HotkeysHelpRail searchHelpApps={searchHelpApps} />{" "}
            <ThemeToggleRail />{" "}
          </div>{" "}
        </div>
      )}{" "}
      {/* ── Main content (row 2) ── */}{" "}
      <div class="flex flex-col min-h-0 min-w-0 bg-zinc-50 dark:bg-zinc-950">
        {" "}
        {user && <ProfileWarnings user={user} />} {user && <ExpiryWarnings user={user} />}{" "}
        <main
          class={`flex-1 min-h-0 ${contentPadding} ${fullPage || fullWidth ? "md:overflow-hidden flex flex-col" : "md:overflow-auto"}`}
        >
          {" "}
          {children}{" "}
        </main>{" "}
      </div>{" "}
      {/* ── Footer / Bottom bar (row 3) ── */}{" "}
      {!fullPage && !showRail && (
        <div>
          {" "}
          <div class="hidden md:block">
            {" "}
            <Footer isLoggedIn={!!user} appName={settings?.app?.copyright || appName} legalLinks={legalLinks} />{" "}
          </div>{" "}
        </div>
      )}{" "}
    </div>
  );
}
