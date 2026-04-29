/**
 * defineApp() — The single entry point for every cloud app.
 *
 * Merges SSR config, app meta, and server bootstrap into one call.
 * Returns `{ ssr, plugin, config, meta, start }`.
 */
import { createConfig as createSsrConfig } from "@valentinkolb/ssr";
import { createSSRHandler, routes } from "@valentinkolb/ssr/hono";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { SsrConfig } from "@valentinkolb/ssr";
import type {
  AppMeta,
  AppLifecycle,
  AppCapabilities,
  AppSearchContext,
  CloudContext,
} from "../contracts/app";
import type { AppRegistryEntry } from "../contracts/registry";
import type { Role } from "../contracts/shared";
import type { AppSettingsMap, KindToType } from "../contracts/settings-types";
import { createSettingsAPI, type SettingsAPI } from "../services/settings/api";
import { registerSettings, type SettingDef } from "../services/settings/defaults";
import { auth } from "../server/middleware/auth";
import { logger } from "../services/logging";
import { get, set, loadCache as loadSettingsCache } from "../services/settings";
import { createHeartbeat } from "./heartbeat";
import { ensureRuntimeWatcher, getCurrentRuntime, stopRuntimeWatcher } from "./runtime-watcher";

/** Cache-busting version stamp — changes on every server start / rebuild. */
const v = Date.now();

type PageOptions = {
  title?: string;
  description?: string;
  theme?: "light" | "dark";
};

// ── Public types ────────────────────────────────────────────────────────────

/**
 * App definition options.
 *
 * `S` is the inferred per-app settings map (see `AppSettingsMap`). Apps that
 * declare `settings: { ... } as const` get S inferred to the literal shape;
 * `AppContext<typeof app>` then exposes the typed snapshot on `c.get("settings")`.
 *
 * Apps that omit `settings` get S = {} (no own settings — only core's are
 * available in their snapshot, populated by core's own defineApp.settings).
 */
export type AppOptions<S extends AppSettingsMap = {}> = {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** URL prefix for SSR asset isolation. Omit for the global `/_ssr/` path (core). */
  basePath?: string;
  /** Base URL as seen by other containers (e.g. "http://app-notebooks:3000"). */
  baseUrl: string;
  adminHref?: string;
  nav?: {
    href: string;
    match?: string;
    section: "primary" | "more" | "hidden";
    requiresAuth?: boolean;
    requiresRoles?: Role[];
  };
  /**
   * Settings owned by this app, declared as a map of dotted-key → definition.
   *
   * Example: `{ "files.filegate_url": { kind: "url", default: "" } }`.
   *
   * These keys are exposed as a typed nested snapshot on `c.get("settings")`
   * for any Hono route using `Hono<AppContext<typeof app>>`. Writes go through
   * `app.settings.set(key, value)` (also typed). The runtime registry
   * (`SETTINGS_MAP` in `services/settings/defaults.ts`) is populated from
   * this map automatically on `defineApp()` call.
   */
  settings?: S;
  /**
   * Legal/info links contributed by this app — aggregated app-wide via
   * `listLegalLinks()` and rendered in login footer, app Footer, rail more
   * dropdown. Each app contributes its own (e.g. settings owns
   * Imprint/Privacy/Terms; faq owns FAQ). KISS: no `external` flag, links
   * always open in a new tab from the login footer.
   */
  legalLinks?: ReadonlyArray<{ label: string; href: string; icon?: string }>;
  /**
   * Dashboard widget endpoints this app exposes. Each entry references an
   * HTTP path on this app that returns a `WidgetResponse`. The dashboard
   * fetches them with the user's cookie forwarded; the endpoint is
   * responsible for permission gating (200 = render, 204 = skip silently).
   */
  widgets?: ReadonlyArray<{ id: string; path: string }>;
  /**
   * Top-level URL prefixes the gateway should route to this app.
   *
   * Standard apps follow a four-prefix convention:
   *   `/api/<id>`     — widget, admin, ws, crud — everything HTTP API
   *   `/app/<id>`     — user-facing SSR pages
   *   `/admin/<id>`   — admin SSR pages
   *   `/public/<id>`  — built CSS and other static assets
   *
   * Apps with non-standard URLs (core's `/auth`, `/me`; oauth's `/oauth`,
   * `/.well-known/...`; settings' `/legal/*`, `/impressum`) list whatever
   * top-level paths they own. The gateway is dumb — it just builds a
   * prefix-trie from these strings.
   */
  routes: readonly string[];
  /**
   * Project root used by the SSR plugin to discover island/client files.
   * Defaults to `process.cwd()`. Override only if you run the entrypoint
   * from a directory other than the project root.
   */
  appRoot?: string;
};

export type StartOptions = {
  /**
   * Web-standard fetch handler. Mounted at `/` of the app's container.
   * Typically you pass a Hono instance's `.fetch`:
   *
   *   const router = new Hono<AuthContext>()
   *     .use("*", middleware.runtime())
   *     .use("*", middleware.settings())
   *     .route("/api/<id>", apiRoutes)
   *     .route("/app/<id>", pageRoutes);
   *
   *   app.start({ fetch: router.fetch });
   *
   * The framework owns `/_ssr/*`, `/public/*`, and `/api/_internal/search`
   * (the last only when `capabilities.search` is set) and registers them
   * before this fetch — they take precedence over any catch-all the app
   * might register.
   */
  fetch: (req: Request) => Response | Promise<Response>;
  lifecycle?: AppLifecycle;
  capabilities?: AppCapabilities;
  port?: number;
  skipSetup?: boolean;
};

export type StartResult = {
  port: number;
  fetch: Hono["fetch"];
};

export type AppDefinition<S extends AppSettingsMap = {}> = {
  // Bind the generic explicitly — without it, ssr collapses to the constraint
  // `object` and apps lose the typed `c.get("page")` (title/description/theme).
  ssr: ReturnType<typeof createSSRHandler<PageOptions>>;
  plugin: () => import("bun").BunPlugin;
  config: SsrConfig;
  meta: AppMeta;
  baseUrl: string;
  start: (opts: StartOptions) => Promise<StartResult>;
  /**
   * Phantom field — type-only carrier for the per-app settings shape. Always
   * `undefined` at runtime; do not read or assign. Used by `AppContext<App>`
   * to extract the inferred settings map via `App["_settings"]`.
   */
  readonly _settings: S;
  /**
   * Typed async settings API for this app. Keys constrained to those declared
   * in `defineApp({ settings: ... })`. Backed by Redis cache-aside (see store.ts).
   *
   * Use for read/write outside of request-scoped sync access. Inside HTTP
   * handlers, prefer `c.get("settings").x.y` (the per-request snapshot, sync,
   * frozen for the duration of the request).
   */
  readonly settings: SettingsAPI<{ [K in keyof S]: KindToType<S[K]["kind"]> }>;
};

// ── Implementation ──────────────────────────────────────────────────────────

export const defineApp = <const S extends AppSettingsMap = {}>(opts: AppOptions<S>): AppDefinition<S> => {
  // ── 0. Register declared settings into the runtime registry ──────────
  // SETTINGS_MAP is the single source of truth for validation in store.ts
  // (writeKey checks SETTINGS_MAP.get(key)) and for snapshot.ts (allKnownKeys
  // returns SETTINGS.map(d => d.key)). Without this registration, app-declared
  // settings would be type-known but runtime-unknown.
  if (opts.settings) {
    const legacyDefs: SettingDef[] = Object.entries(opts.settings).map(([key, def]) => {
      const d = def as Record<string, unknown>;
      return {
        key,
        // Group derived from the dotted prefix (admin UIs use this for tab
        // grouping; the new bespoke admin UIs ignore it but legacy paths use it).
        group: key.split(".")[0] ?? "app",
        kind: d.kind as SettingDef["kind"],
        // The cast loses the per-kind discriminated default type but the data
        // is correct; legacy validateSettingValue re-validates against kind anyway.
        default: d.default as never,
        label: d.label as string | undefined,
        description: (d.description as string | undefined) ?? "",
        placeholder: d.placeholder as string | undefined,
        envFallback: d.envFallback as (() => unknown) | undefined,
        envBootstrap: d.envBootstrap as (() => unknown) | undefined,
        templateVars: d.templateVars as readonly string[] | undefined,
        options: d.options as ReadonlyArray<{ value: string; label: string }> | undefined,
        min: d.min as number | undefined,
        max: d.max as number | undefined,
      } as SettingDef;
    });
    registerSettings(legacyDefs);
  }

  // ── 1. SSR config ─────────────────────────────────────────────────────
  const { config, plugin, html } = createSsrConfig<PageOptions>({
    dev: process.env.NODE_ENV !== "production",
    verbose: true,
    rootDir: opts.appRoot ?? process.cwd(),
    basePath: opts.basePath,
    template: ({ body, scripts, title, description, theme }) => {
      const themeFixed = theme !== undefined;
      return `<!DOCTYPE html>
<html lang="de" class="${theme ?? "light"}"${themeFixed ? " data-theme-fixed" : ""}>
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="view-transition" content="same-origin">
    <title>${title ?? "Cloud"}</title>
    <meta name="description" content="${description ?? "Cloud workspace"}">
    <meta name="theme-color" content="#09090b">
    <meta name="mobile-web-app-capable" content="yes">
    <link rel="icon" href="/branding/favicon">
    <link rel="stylesheet" href="/public/global.css?v=${v}">
    <link rel="stylesheet" href="/public/${opts.id}/app.css?v=${v}">
    <script>
      (function() {
        var el = document.documentElement;
        if (!el.hasAttribute('data-theme-fixed')) {
          var theme = document.cookie.match(/theme=([^;]+)/)?.[1] || 'light';
          el.classList.add(theme);
        }
      })();
    </script>
  </head>
  <body>
    ${body}
  </body>
  ${scripts}
</html>`;
    },
  });

  // Pass PageOptions explicitly so c.get("page") in apps' SSR handlers is
  // typed as Partial<PageOptions> (with title/description/theme), not the
  // bare `object` fallback the constraint would otherwise produce.
  const ssr = createSSRHandler<PageOptions>(html);

  // ── 2. Meta ───────────────────────────────────────────────────────────
  const meta: AppMeta = {
    id: opts.id,
    name: opts.name,
    icon: opts.icon,
    description: opts.description,
    adminHref: opts.adminHref,
    routes: [...opts.routes],
    nav: opts.nav,
    legalLinks: opts.legalLinks ? [...opts.legalLinks] : undefined,
    widgets: opts.widgets ? opts.widgets.map((w) => ({ ...w })) : undefined,
  };

  // ── 3. start() — builds and boots the Hono server ────────────────────
  const start = async (startOpts: StartOptions): Promise<StartResult> => {
    const port = startOpts.port ?? 3000;
    const baseUrl = opts.baseUrl;
    const log = logger("app");

    // Registry entry
    const entry: AppRegistryEntry = {
      id: meta.id,
      name: meta.name,
      icon: meta.icon,
      description: meta.description,
      baseUrl,
      routes: [...meta.routes],
      nav: (meta.nav || meta.adminHref)
        ? {
            href: meta.nav?.href ?? "",
            match: meta.nav?.match,
            section: meta.nav?.section ?? "hidden",
            requiresAuth: meta.nav?.requiresAuth,
            requiresRoles: meta.nav?.requiresRoles,
            adminHref: meta.adminHref,
          }
        : undefined,
      search: startOpts.capabilities?.search
        ? {
            tags: [...(startOpts.capabilities.search.tags ?? [])],
            help: startOpts.capabilities.search.help ?? "",
            tagHelp: [...(startOpts.capabilities.search.tagHelp ?? [])],
            endpoint: `${baseUrl}/api/_internal/search`,
          }
        : undefined,
      legalLinks: meta.legalLinks ? meta.legalLinks.map((l) => ({ ...l })) : undefined,
      widgets: meta.widgets ? meta.widgets.map((w) => ({ ...w })) : undefined,
    };

    // Heartbeat
    const heartbeat = createHeartbeat(meta.id, entry);
    await heartbeat.start();
    log.info(`Registered "${meta.id}"`, { baseUrl });

    // Runtime context — start the registry watcher so middleware.runtime() and
    // the lifecycle context below see populated cluster state. Idempotent: the
    // watcher is a module-level singleton, only one runs per process.
    await ensureRuntimeWatcher();

    // Build Hono server. Framework owns three mounts (registered first so
    // they take precedence over any catch-all in the user's fetch):
    //   /_ssr/*                 island chunks (SSR adapter)
    //   /public/*               serveStatic + terminal 404
    //   /api/_internal/search   only when capabilities.search is declared
    const ssrMountPath = config.basePath ? `${config.basePath}/_ssr` : "/_ssr";

    const server = new Hono()
      .route(ssrMountPath, routes(config))
      .use("/public/*", serveStatic({
        root: "./",
        onFound: (_path, c) => {
          c.header("Cache-Control", "public, max-age=31536000, immutable");
        },
      }))
      // serveStatic calls next() on miss — terminate /public/* here so a
      // missing asset is a clean 404 instead of falling through to the app
      // fetch (which might render an HTML page for the missing path).
      .all("/public/*", (c) => c.notFound());

    if (startOpts.capabilities?.search) {
      const searchRun = startOpts.capabilities.search.run;
      server.post("/api/_internal/search", auth.requireRole("authenticated"), async (c) => {
        const body = await c.req.json<{ query: string; tags: string[]; limit: number }>();
        const ctx: AppSearchContext = { get: (key) => c.get(key) as never };
        const results = await searchRun({ query: body.query, tags: body.tags, limit: body.limit, ctx });
        return c.json(results);
      });
    }

    // User's fetch handles everything else. The framework doesn't inject any
    // context vars here — the user's router is expected to register the
    // middlewares it needs (middleware.runtime, middleware.settings, …).
    server.all("*", (c) => Promise.resolve(startOpts.fetch(c.req.raw)));

    // Lifecycle
    const cloudCtx: CloudContext = {
      logger,
      settings: { get, set },
      runtime: getCurrentRuntime(),
    };

    if (!startOpts.skipSetup && startOpts.lifecycle?.setup) {
      log.info(`Setup: ${meta.id}`);
      await startOpts.lifecycle.setup(cloudCtx);
    }

    await loadSettingsCache();

    if (startOpts.lifecycle?.start) {
      log.info(`Start: ${meta.id}`);
      await startOpts.lifecycle.start(cloudCtx);
    }

    // Graceful shutdown
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      log.info(`Stopping: ${meta.id}`);
      try { if (startOpts.lifecycle?.stop) await startOpts.lifecycle.stop(cloudCtx); } catch {}
      stopRuntimeWatcher();
      await heartbeat.stop();
    };

    process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
    process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));

    return { port, fetch: server.fetch };
  };

  return {
    ssr,
    plugin,
    config,
    meta,
    baseUrl: opts.baseUrl,
    start,
    // Phantom — see AppDefinition._settings doc. Do not read at runtime.
    _settings: undefined as unknown as S,
    settings: createSettingsAPI<S>(),
  };
};
