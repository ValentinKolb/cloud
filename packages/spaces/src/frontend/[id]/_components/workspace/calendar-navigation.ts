import { documentNavigate, listenPopState, navigate } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { prompts } from "@k2b/ui";
import { createSignal, onCleanup, onMount } from "solid-js";
import { loadSpacesViewSnapshot, SpacesViewUnavailableError } from "./view-refresh";
import {
  reconcileSpacesDetailRoute,
  resolveCalendarNavigationHref,
  SPACES_DATA_INVALIDATED_EVENT,
  type SpacesDataInvalidation,
} from "./workspace-events";
import type { SpacesViewSnapshot } from "./workspace-types";

type CalendarSnapshot = Extract<SpacesViewSnapshot, { kind: "calendar" }>;
type NavigationReason = "navigation" | "popstate" | "refresh";

type CalendarNavigationRequest = {
  href: string;
  reason: NavigationReason;
};

type CalendarNavigationContext = {
  request: CalendarNavigationRequest;
  requestId: number;
  dataVersion: number;
};

type CalendarNavigationResult = {
  href: string;
  snapshot: CalendarSnapshot;
};

const CACHE_LIMIT = 8;
const LOADING_MIN_VISIBLE_MS = 180;
const NAVIGATION_SETTLE_MS = 60;
const REFRESH_DELAY_MS = 120;

const pathWithQuery = (url: URL) => `${url.pathname}${url.search}`;

const isExplicitCalendarHref = (href: string, origin: string) => new URL(href, origin).searchParams.get("view") === "calendar";

const loadCalendarSnapshot = async (href: string, signal?: AbortSignal): Promise<CalendarSnapshot> => {
  const snapshot = await loadSpacesViewSnapshot(href, signal);
  if (snapshot.kind !== "calendar") throw new Error("The requested route is not a calendar view");
  return snapshot;
};

const createSnapshotCache = () => {
  const resolved = new Map<string, CalendarSnapshot>();
  const pending = new Map<string, { controller: AbortController; promise: Promise<CalendarSnapshot> }>();
  let generation = 0;

  const remember = (href: string, snapshot: CalendarSnapshot) => {
    resolved.delete(href);
    resolved.set(href, snapshot);
    while (resolved.size > CACHE_LIMIT) {
      const oldest = resolved.keys().next().value;
      if (!oldest) break;
      resolved.delete(oldest);
    }
  };

  const read = (href: string) => {
    const snapshot = resolved.get(href);
    if (!snapshot) return null;
    remember(href, snapshot);
    return snapshot;
  };

  const load = async (href: string, signal: AbortSignal) => {
    const cached = read(href);
    if (cached) return cached;
    const prefetched = pending.get(href);
    if (prefetched) return prefetched.promise;
    return loadCalendarSnapshot(href, signal);
  };

  const cancelPendingExcept = (href?: string) => {
    for (const [pendingHref, entry] of pending) {
      if (pendingHref === href) continue;
      entry.controller.abort();
      pending.delete(pendingHref);
    }
  };

  const prefetch = (href: string) => {
    // Only the latest explicit user intent is worth spending server work on.
    cancelPendingExcept(href);
    if (resolved.has(href) || pending.has(href)) return;
    const controller = new AbortController();
    const startedInGeneration = generation;
    const promise = loadCalendarSnapshot(href, controller.signal)
      .then((snapshot) => {
        if (generation === startedInGeneration) remember(href, snapshot);
        return snapshot;
      })
      .finally(() => {
        if (pending.get(href)?.promise === promise) pending.delete(href);
      });
    // Intent prefetch is opportunistic; navigation retains the real error path.
    void promise.catch(() => undefined);
    pending.set(href, { controller, promise });
  };

  const clear = () => {
    generation += 1;
    resolved.clear();
    cancelPendingExcept();
  };

  return { cancelPendingExcept, clear, load, prefetch, read, remember };
};

/**
 * Owns only enhanced calendar navigation. Canonical links and server loaders
 * remain the baseline when JavaScript is unavailable or a client load fails.
 */
export const useSpacesCalendarNavigation = (params: {
  spaceId: string;
  initialSnapshot: CalendarSnapshot;
  apply: (snapshot: CalendarSnapshot) => void;
  preview: (href: string) => void;
}) => {
  const expectedPath = `/app/spaces/${params.spaceId}`;
  const knownCalendarHrefs = new Set<string>();
  const cache = createSnapshotCache();
  const [pending, setPending] = createSignal(false);
  let activeRequest: CalendarNavigationRequest | null = null;
  let activeRequestId = 0;
  let dataVersion = 0;
  let loadingHideTimer: ReturnType<typeof setTimeout> | undefined;
  let loadingShownAt: number | undefined;
  let navigationTimer: ReturnType<typeof setTimeout> | undefined;
  let queuedNavigation: CalendarNavigationRequest | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let invalidatedRequest: CalendarNavigationRequest | null = null;

  const normalize = (href: string) => resolveCalendarNavigationHref(href, window.location.origin, expectedPath);
  const currentHref = () => pathWithQuery(new URL(window.location.href));
  const isCalendarHref = (href: string) => knownCalendarHrefs.has(href) || isExplicitCalendarHref(href, window.location.origin);

  const stopLoading = (requestId: number) => {
    if (requestId !== activeRequestId) return;
    activeRequest = null;

    const hide = () => {
      if (requestId !== activeRequestId) return;
      loadingHideTimer = undefined;
      loadingShownAt = undefined;
      setPending(false);
    };
    const visibleFor = loadingShownAt === undefined ? LOADING_MIN_VISIBLE_MS : performance.now() - loadingShownAt;
    const remaining = pending() ? Math.max(0, LOADING_MIN_VISIBLE_MS - visibleFor) : 0;
    if (remaining > 0) loadingHideTimer = setTimeout(hide, remaining);
    else hide();
  };

  const fallback = (request: CalendarNavigationRequest) => {
    // Client history already points at the target; replace it with the SSR page.
    documentNavigate(request.href, { replace: true });
  };

  const navigation = mutations.create<CalendarNavigationResult, CalendarNavigationRequest, CalendarNavigationContext>({
    onBefore: (request) => {
      const requestId = ++activeRequestId;
      activeRequest = request;
      if (loadingHideTimer) clearTimeout(loadingHideTimer);
      loadingHideTimer = undefined;
      if (!pending()) {
        loadingShownAt = performance.now();
        setPending(true);
      }
      return { request, requestId, dataVersion };
    },
    mutation: async (request, context) => ({
      href: request.href,
      snapshot: await cache.load(request.href, context.abortSignal),
    }),
    onSuccess: (result, context) => {
      if (!context || context.requestId !== activeRequestId) return;
      if (context.dataVersion !== dataVersion) {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = undefined;
        void run(context.request);
        return;
      }
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = undefined;
      invalidatedRequest = null;
      cache.remember(result.href, result.snapshot);
      knownCalendarHrefs.add(result.href);
      params.apply(result.snapshot);
    },
    onError: (error, context) => {
      if (!context || context.requestId !== activeRequestId) return;
      if (context.request.reason === "refresh" && !(error instanceof SpacesViewUnavailableError)) {
        prompts.error(error.message);
        return;
      }
      fallback(context.request);
    },
    onFinally: (context) => {
      if (context) stopLoading(context.requestId);
    },
  });

  const run = (request: CalendarNavigationRequest) => {
    const href = normalize(request.href);
    if (!href || (request.reason === "popstate" && !isCalendarHref(href))) {
      fallback({ ...request, href: href ?? request.href });
      return Promise.resolve();
    }
    navigation.abort();
    return navigation.mutate({ ...request, href });
  };

  const clearQueuedNavigation = () => {
    if (navigationTimer) clearTimeout(navigationTimer);
    navigationTimer = undefined;
    queuedNavigation = null;
  };

  const queueNavigation = (request: CalendarNavigationRequest) => {
    queuedNavigation = request;
    if (navigationTimer) clearTimeout(navigationTimer);
    // Update the route immediately, but collapse rapid arrow clicks into one load.
    navigationTimer = setTimeout(() => {
      navigationTimer = undefined;
      const queued = queuedNavigation;
      queuedNavigation = null;
      if (queued) void run(queued);
    }, NAVIGATION_SETTLE_MS);
  };

  const selectTarget = (href: string) => {
    navigation.abort();
    cache.cancelPendingExcept(href);
    const cached = cache.read(href);
    if (cached) params.apply(cached);
    else params.preview(href);
    return cached;
  };

  const open = (rawHref: string, options: { replace?: boolean } = {}) => {
    const href = normalize(rawHref);
    if (!href) {
      documentNavigate(rawHref, { replace: options.replace });
      return;
    }
    const cached = selectTarget(href);
    navigate(href, { replace: options.replace, scroll: "preserve", viewTransition: false });
    reconcileSpacesDetailRoute(href);
    if (cached) clearQueuedNavigation();
    else queueNavigation({ href, reason: "navigation" });
  };
  const navigateHref = (href: string) => open(href);

  const prefetch = (href: string) => {
    const target = normalize(href);
    if (target && isExplicitCalendarHref(target, window.location.origin)) cache.prefetch(target);
  };

  const scheduleRefresh = () => {
    dataVersion += 1;
    cache.clear();
    invalidatedRequest = activeRequest ? { ...activeRequest } : { href: currentHref(), reason: "refresh" };
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      const request = activeRequest ? { ...activeRequest } : invalidatedRequest;
      invalidatedRequest = null;
      if (!request) return;
      void run(request);
    }, REFRESH_DELAY_MS);
  };

  onMount(() => {
    const initialHref = currentHref();
    knownCalendarHrefs.add(initialHref);
    cache.remember(initialHref, params.initialSnapshot);
    const stopPopState = listenPopState(({ url }) => {
      const href = normalize(pathWithQuery(url));
      if (!href || !isCalendarHref(href)) {
        documentNavigate(href ?? pathWithQuery(url), { replace: true });
        return;
      }
      clearQueuedNavigation();
      const cached = selectTarget(href);
      reconcileSpacesDetailRoute(href);
      if (!cached) void run({ href, reason: "popstate" });
    });
    const onInvalidated = (event: Event) => {
      const invalidation = (event as CustomEvent<SpacesDataInvalidation>).detail;
      if (invalidation?.domains.includes("view")) scheduleRefresh();
    };
    window.addEventListener(SPACES_DATA_INVALIDATED_EVENT, onInvalidated);
    onCleanup(() => {
      stopPopState();
      window.removeEventListener(SPACES_DATA_INVALIDATED_EVENT, onInvalidated);
      navigation.abort();
      clearQueuedNavigation();
      cache.clear();
      if (loadingHideTimer) clearTimeout(loadingHideTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      invalidatedRequest = null;
    });
  });

  return { navigateHref, open, pending, prefetch };
};
