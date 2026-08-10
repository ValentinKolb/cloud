export type ContactsResultsNavigationResult =
  | { kind: "applied"; href: string }
  | { kind: "superseded" }
  | { kind: "fallback"; href: string };

type PendingNavigation = {
  source: string;
  fallbackHref: string;
  retainCommitted: boolean;
  onApply?: (href: string) => void;
  onFallback?: (href: string) => void;
  resolve: (result: ContactsResultsNavigationResult) => void;
};

type Options = {
  initialSource: string;
  initialHref: string;
  setSource: (source: string) => void;
};

export const selectContactsResultsSnapshot = <T extends { source: string; href: string }>(options: {
  loaded: T | undefined;
  source: string;
  committedSource: string;
  canRenderCommitted: boolean;
}): T | undefined => {
  const { loaded } = options;
  if (!loaded) return undefined;
  if (loaded.source === options.source) return loaded;
  if (!options.canRenderCommitted) return undefined;
  if (loaded.source === options.committedSource || loaded.href === options.committedSource) return loaded;
  return undefined;
};

export const createContactsResultsNavigation = (options: Options) => {
  let committedSource = options.initialSource;
  let committedHref = options.initialHref;
  let pending: PendingNavigation | undefined;

  const supersede = () => {
    if (!pending) return;
    pending.resolve({ kind: "superseded" });
    pending = undefined;
    options.setSource(committedSource);
  };

  const navigate = (
    source: string,
    navigation: {
      fallbackHref?: string;
      retainCommitted?: boolean;
      onApply?: (href: string) => void;
      onFallback?: (href: string) => void;
    } = {},
  ): Promise<ContactsResultsNavigationResult> => {
    supersede();
    if (source === committedSource || source === committedHref) {
      navigation.onApply?.(committedHref);
      return Promise.resolve({ kind: "applied", href: committedHref });
    }

    return new Promise((resolve) => {
      pending = {
        source,
        fallbackHref: navigation.fallbackHref ?? source,
        retainCommitted: navigation.retainCommitted !== false,
        onApply: navigation.onApply,
        onFallback: navigation.onFallback,
        resolve,
      };
      options.setSource(source);
    });
  };

  const apply = (source: string, href: string, applyState: () => void): boolean => {
    const request = pending;
    if (!request || request.source !== source) return false;
    pending = undefined;
    committedSource = href;
    committedHref = href;
    applyState();
    if (source !== href) options.setSource(href);
    request.onApply?.(href);
    request.resolve({ kind: "applied", href });
    return true;
  };

  const fail = (source: string): boolean => {
    const request = pending;
    if (!request || request.source !== source) return false;
    pending = undefined;
    options.setSource(committedSource);
    request.onFallback?.(request.fallbackHref);
    request.resolve({ kind: "fallback", href: request.fallbackHref });
    return true;
  };

  const dispose = () => {
    pending?.resolve({ kind: "superseded" });
    pending = undefined;
  };

  return {
    navigate,
    apply,
    fail,
    supersede,
    dispose,
    committedSource: () => committedSource,
    committedHref: () => committedHref,
    canRenderCommitted: () => pending?.retainCommitted !== false,
  };
};
