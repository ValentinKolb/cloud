export type QueryKeys = {
  search: string;
  page: string;
};

export type GroupQueryKeys = QueryKeys & {
  showAll: string;
};

export const USERS_QUERY_KEYS: QueryKeys = {
  search: "search",
  page: "page",
};

export const GROUPS_QUERY_KEYS: GroupQueryKeys = {
  search: "search",
  page: "page",
  showAll: "show_all",
};

/**
 * Group list state keys used inside group-detail routes.
 * This keeps list context separate from tab-local query params.
 */
export const GROUPS_CONTEXT_QUERY_KEYS: GroupQueryKeys = {
  search: "list_search",
  page: "list_page",
  showAll: "list_show_all",
};

export type UsersListState = {
  search: string;
  page: number;
};

export type GroupsListState = {
  search: string;
  page: number;
  showAll: boolean;
};

type GroupsStateOptions = {
  defaultShowAll?: boolean;
  keys?: GroupQueryKeys;
};

const parsePage = (value: number | string | null | undefined): number => {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
  if (!value) return 1;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const parseBoolean = (value: string | boolean | null | undefined, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
};

const normalizeSearch = (value: string | null | undefined): string => (value ?? "").trim();

const toHref = (basePath: string, searchParams: URLSearchParams): string => {
  const query = searchParams.toString();
  return query.length > 0 ? `${basePath}?${query}` : basePath;
};

const writeIfNonDefault = (params: URLSearchParams, key: string, value: string, defaultValue: string): void => {
  if (value === defaultValue) {
    params.delete(key);
    return;
  }
  params.set(key, value);
};

export const parseUsersListState = (input: { search?: string | null; page?: number | string | null }): UsersListState => ({
  search: normalizeSearch(input.search),
  page: parsePage(input.page),
});

export const parseUsersListStateFromParams = (params: URLSearchParams, keys: QueryKeys = USERS_QUERY_KEYS): UsersListState =>
  parseUsersListState({
    search: params.get(keys.search),
    page: params.get(keys.page),
  });

export const writeUsersListState = (params: URLSearchParams, state: UsersListState, keys: QueryKeys = USERS_QUERY_KEYS): void => {
  writeIfNonDefault(params, keys.search, state.search, "");
  writeIfNonDefault(params, keys.page, String(state.page), "1");
};

export const buildUsersUrl = (
  state: UsersListState,
  options: {
    basePath?: string;
    keys?: QueryKeys;
  } = {},
): string => {
  const params = new URLSearchParams();
  writeUsersListState(params, state, options.keys ?? USERS_QUERY_KEYS);
  return toHref(options.basePath ?? "/app/accounts/users", params);
};

export const buildUsersPageBaseUrl = (
  state: Pick<UsersListState, "search">,
  options: {
    basePath?: string;
    keys?: QueryKeys;
  } = {},
): string => {
  const params = new URLSearchParams();
  writeIfNonDefault(params, (options.keys ?? USERS_QUERY_KEYS).search, state.search, "");
  const query = params.toString();
  const basePath = options.basePath ?? "/app/accounts/users";
  return query.length > 0
    ? `${basePath}?${query}&${(options.keys ?? USERS_QUERY_KEYS).page}=`
    : `${basePath}?${(options.keys ?? USERS_QUERY_KEYS).page}=`;
};

export const buildUserDetailUrl = (
  userId: string,
  state: UsersListState,
  options: {
    basePath?: string;
    keys?: QueryKeys;
  } = {},
): string => {
  const basePath = options.basePath ?? `/app/accounts/users/${userId}`;
  const params = new URLSearchParams();
  writeUsersListState(params, state, options.keys ?? USERS_QUERY_KEYS);
  return toHref(basePath, params);
};

export const parseGroupsListState = (
  input: {
    search?: string | null;
    page?: number | string | null;
    showAll?: string | boolean | null;
  },
  options: GroupsStateOptions = {},
): GroupsListState => {
  const defaultShowAll = options.defaultShowAll ?? false;

  return {
    search: normalizeSearch(input.search),
    page: parsePage(input.page),
    showAll: parseBoolean(input.showAll, defaultShowAll),
  };
};

export const parseGroupsListStateFromParams = (params: URLSearchParams, options: GroupsStateOptions = {}): GroupsListState => {
  const keys = options.keys ?? GROUPS_QUERY_KEYS;

  return parseGroupsListState(
    {
      search: params.get(keys.search),
      page: params.get(keys.page),
      showAll: params.get(keys.showAll),
    },
    options,
  );
};

export const writeGroupsListState = (params: URLSearchParams, state: GroupsListState, options: GroupsStateOptions = {}): void => {
  const keys = options.keys ?? GROUPS_QUERY_KEYS;
  const defaultShowAll = options.defaultShowAll ?? false;

  writeIfNonDefault(params, keys.search, state.search, "");
  writeIfNonDefault(params, keys.page, String(state.page), "1");
  writeIfNonDefault(params, keys.showAll, String(state.showAll), String(defaultShowAll));
};

export const buildGroupsUrl = (
  state: GroupsListState,
  options: {
    basePath?: string;
  } & GroupsStateOptions = {},
): string => {
  const params = new URLSearchParams();
  writeGroupsListState(params, state, options);
  return toHref(options.basePath ?? "/app/accounts/groups", params);
};

export const buildGroupsPageBaseUrl = (
  state: Pick<GroupsListState, "search" | "showAll">,
  options: {
    basePath?: string;
  } & GroupsStateOptions = {},
): string => {
  const keys = options.keys ?? GROUPS_QUERY_KEYS;
  const defaultShowAll = options.defaultShowAll ?? false;
  const params = new URLSearchParams();

  writeIfNonDefault(params, keys.search, state.search, "");
  writeIfNonDefault(params, keys.showAll, String(state.showAll), String(defaultShowAll));

  const query = params.toString();
  const basePath = options.basePath ?? "/app/accounts/groups";
  return query.length > 0 ? `${basePath}?${query}&${keys.page}=` : `${basePath}?${keys.page}=`;
};

export const buildGroupDetailUrl = (
  groupCn: string,
  state: GroupsListState,
  options: {
    basePath?: string;
  } & GroupsStateOptions = {},
): string => {
  const basePath = options.basePath ?? `/app/accounts/groups/${groupCn}`;
  const params = new URLSearchParams();
  writeGroupsListState(params, state, options);
  return toHref(basePath, params);
};
