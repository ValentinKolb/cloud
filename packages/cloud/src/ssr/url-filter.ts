/**
 * URL-backed filter state for server-rendered pages.
 *
 * Every admin page reimplemented the same triple — parse the query string,
 * rebuild it with a patch, decide whether anything is active — and the copies
 * diverged in ways that leaked into behaviour: some baked the path in and some
 * took it as a parameter, some reset pagination and some did not, one dropped
 * the time window when clearing filters, and several rebuilt the pagination
 * base URL a second time by hand.
 *
 * The URL stays the single source of truth: filtering, sorting and paging are
 * server concerns, and a page that keeps them in the address bar is reloadable
 * and shareable by construction.
 */

export type UrlFilterField<T> = {
  /** Query parameter name. */
  param: string;
  /** Value when the parameter is absent or invalid. Omitted from built URLs. */
  fallback: T;
  /** Rejects hand-edited values before they reach SQL. */
  parse: (raw: string | null, all: string[]) => T;
  /** Omit the parameter entirely by returning an empty array. */
  serialize?: (value: T) => string[];
};

// biome-ignore lint/suspicious/noExplicitAny: each field carries its own value type; `any` is the only constraint that preserves them through inference.
type FieldMap = Record<string, UrlFilterField<any>>;

type StateOf<F extends FieldMap> = { [K in keyof F]: F[K] extends UrlFilterField<infer T> ? T : never };

const defaultSerialize = (value: unknown): string[] => {
  if (value === null || value === undefined || value === "" || value === false) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
};

/** A string field constrained to a known set — the common case for enums. */
export const oneOf = <T extends string>(param: string, values: readonly T[], fallback: T): UrlFilterField<T> => ({
  param,
  fallback,
  parse: (raw) => (raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : fallback),
});

export const text = (param: string, fallback = ""): UrlFilterField<string> => ({
  param,
  fallback,
  parse: (raw) => raw?.trim() ?? fallback,
});

/** Present-means-true, so the parameter disappears when switched off. */
export const flag = (param: string): UrlFilterField<boolean> => ({
  param,
  fallback: false,
  parse: (raw) => raw === "1",
  serialize: (value) => (value ? ["1"] : []),
});

export const list = (param: string): UrlFilterField<string[]> => ({
  param,
  fallback: [],
  parse: (_raw, all) => [...new Set(all.map((value) => value.trim()).filter(Boolean))],
});

export const page = (param = "page"): UrlFilterField<number> => ({
  param,
  fallback: 1,
  parse: (raw) => {
    const parsed = Number(raw ?? "1");
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1;
  },
  serialize: (value) => (value > 1 ? [String(value)] : []),
});

export const createUrlFilter = <F extends FieldMap>(basePath: string, fields: F) => {
  const entries = Object.entries(fields) as [keyof F & string, UrlFilterField<unknown>][];

  const parse = (url: URL): StateOf<F> => {
    const state = {} as Record<string, unknown>;
    for (const [key, field] of entries) {
      state[key] = field.parse(url.searchParams.get(field.param), url.searchParams.getAll(field.param));
    }
    return state as StateOf<F>;
  };

  /** Values equal to the fallback are omitted, so the common URL stays clean. */
  const build = (current: StateOf<F>, updates: Partial<StateOf<F>> = {}): string => {
    const next = { ...current, ...updates } as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, field] of entries) {
      const value = next[key];
      if (JSON.stringify(value) === JSON.stringify(field.fallback)) continue;
      for (const serialized of (field.serialize ?? defaultSerialize)(value as never)) params.append(field.param, serialized);
    }
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  /**
   * Pagination components append the page number to this, so it must always
   * end in a usable separator. Eight pages derived it by hand before.
   */
  const paginationBase = (current: StateOf<F>, pageKey: keyof F & string): string => {
    const field = fields[pageKey] as UrlFilterField<unknown> | undefined;
    if (!field) return basePath;
    const url = build({ ...current, [pageKey]: field.fallback } as StateOf<F>);
    return url.includes("?") ? `${url}&${field.param}=` : `${url}?${field.param}=`;
  };

  /** Whether anything differs from the defaults — drives the clear affordance. */
  const isActive = (current: StateOf<F>, ignore: (keyof F & string)[] = []): boolean =>
    entries.some(
      ([key, field]) =>
        !ignore.includes(key) && JSON.stringify((current as Record<string, unknown>)[key]) !== JSON.stringify(field.fallback),
    );

  /** Resets to defaults, optionally keeping fields that are not really filters. */
  const clear = (current: StateOf<F>, keep: (keyof F & string)[] = []): string => {
    const next = {} as Record<string, unknown>;
    for (const [key, field] of entries) {
      next[key] = keep.includes(key) ? (current as Record<string, unknown>)[key] : field.fallback;
    }
    return build(next as StateOf<F>);
  };

  return { basePath, parse, build, paginationBase, isActive, clear };
};
