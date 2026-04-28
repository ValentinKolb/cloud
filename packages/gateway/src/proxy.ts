import type { RouteTable } from "./trie";
import { matchRoute } from "./trie";

// ─── Proxy statistics ────────────────────────────────────────────────────────

export type AppStats = {
  count: number;
  totalMs: number;
  errors: number;
};

/** Per-route hit counter. Bounded to MAX_ROUTE_ENTRIES to prevent unbounded memory growth. */
export type RouteHit = { count: number; errors: number; lastSeen: number };

const MAX_ROUTE_ENTRIES = 500;

export type ProxyStats = {
  totalRequests: number;
  byApp: Map<string, AppStats>;
  byRoute: Map<string, RouteHit>;
  noRouteCount: number;
  startedAt: number;
};

export const createProxyStats = (): ProxyStats => ({
  totalRequests: 0,
  byApp: new Map(),
  byRoute: new Map(),
  noRouteCount: 0,
  startedAt: Date.now(),
});

/** Track a route hit. Evicts oldest entries when over MAX_ROUTE_ENTRIES. */
const trackRoute = (stats: ProxyStats, prefix: string, isError: boolean) => {
  let hit = stats.byRoute.get(prefix);
  if (!hit) {
    // Evict oldest if at capacity
    if (stats.byRoute.size >= MAX_ROUTE_ENTRIES) {
      let oldestKey = "";
      let oldestTime = Infinity;
      for (const [k, v] of stats.byRoute) {
        if (v.lastSeen < oldestTime) { oldestTime = v.lastSeen; oldestKey = k; }
      }
      if (oldestKey) stats.byRoute.delete(oldestKey);
    }
    hit = { count: 0, errors: 0, lastSeen: 0 };
    stats.byRoute.set(prefix, hit);
  }
  hit.count++;
  hit.lastSeen = Date.now();
  if (isError) hit.errors++;
};

// ─── Error rate limiting (prevent log spam when upstream is down) ────────────

const errorThrottle = new Map<string, number>(); // appId → last log timestamp
const ERROR_LOG_INTERVAL_MS = 5_000; // log at most once per 5s per app

const shouldLogError = (appId: string): boolean => {
  const now = Date.now();
  const last = errorThrottle.get(appId) ?? 0;
  if (now - last < ERROR_LOG_INTERVAL_MS) return false;
  errorThrottle.set(appId, now);
  return true;
};

// ─── Request proxying ────────────────────────────────────────────────────────

export const proxyRequest = async (
  req: Request,
  table: RouteTable,
  stats: ProxyStats,
  log: (msg: string, meta?: Record<string, unknown>) => void,
): Promise<Response> => {
  const url = new URL(req.url);
  const start = performance.now();
  stats.totalRequests++;

  const match = matchRoute(table, url.pathname);

  if (!match) {
    stats.noRouteCount++;
    return new Response("Bad Gateway — no app registered for this path", {
      status: 502,
      headers: { "Retry-After": "5" },
    });
  }

  // Track per-app stats
  let appStats = stats.byApp.get(match.appId);
  if (!appStats) {
    appStats = { count: 0, totalMs: 0, errors: 0 };
    stats.byApp.set(match.appId, appStats);
  }
  appStats.count++;
  trackRoute(stats, match.matchedPrefix, false);

  try {
    // Build target URL preserving path and query
    const targetUrl = new URL(url.pathname + url.search, match.baseUrl);

    // Forward the request — fix Host header for upstream
    const fwdHeaders = new Headers(req.headers);
    fwdHeaders.set("Host", targetUrl.host);
    fwdHeaders.set("X-Forwarded-Host", url.host);
    fwdHeaders.set("X-Forwarded-Proto", url.protocol.replace(":", ""));

    const proxyRes = await fetch(targetUrl.href, {
      method: req.method,
      headers: fwdHeaders,
      body: req.body,
      // @ts-ignore - Bun supports duplex for streaming request bodies
      duplex: req.body ? "half" : undefined,
      redirect: "manual",
    });

    const ms = performance.now() - start;
    appStats.totalMs += ms;

    // Copy response headers, add gateway headers
    const headers = new Headers(proxyRes.headers);
    headers.set("X-Gateway-App", match.appId);
    headers.set("X-Gateway-Ms", ms.toFixed(1));

    return new Response(proxyRes.body, {
      status: proxyRes.status,
      statusText: proxyRes.statusText,
      headers,
    });
  } catch (err) {
    const ms = performance.now() - start;
    appStats.totalMs += ms;
    appStats.errors++;
    trackRoute(stats, match.matchedPrefix, true);

    // Throttled logging — at most once per 5s per app
    if (shouldLogError(match.appId)) {
      log("Upstream unavailable", {
        appId: match.appId,
        path: url.pathname,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return new Response("Bad Gateway — upstream unavailable", {
      status: 502,
      headers: { "Retry-After": "3" },
    });
  }
};
