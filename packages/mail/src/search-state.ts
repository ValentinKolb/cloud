import { type MailSearchExpression, type MailSearchState, mailSearchExpressionSchema, mailSearchStateSchema } from "./contracts";

export const MAIL_SEARCH_PARAMETER = "search";
export const MAIL_QUICK_SEARCH_SCOPE_PARAMETER = "qScope";
export const MAIL_QUICK_SEARCH_SCOPES = ["everything", "people", "sender", "recipients", "subject", "body", "attachments"] as const;
export type MailQuickSearchScope = (typeof MAIL_QUICK_SEARCH_SCOPES)[number];
export const DEFAULT_MAIL_QUICK_SEARCH_SCOPE: MailQuickSearchScope = "everything";

// The workspace-route API accepts hrefs up to 4,000 characters. Keeping the
// encoded search value below 3,000 leaves room for the mailbox path and future
// non-search route state without relying on browser-specific URL limits.
export const MAX_MAIL_SEARCH_PARAMETER_LENGTH = 3_000;

export { type MailSearchState, mailSearchStateSchema };

export type ParsedMailSearchState = { state: MailSearchState; error: null } | { state: null; error: string } | { state: null; error: null };

export type SerializedMailSearchState = { ok: true; value: string } | { ok: false; error: string };
export type ResolvedMailSearchRoute = {
  query: string;
  expression: MailSearchExpression | null;
  sort: MailSearchState["sort"];
  error: string | null;
};

const encodedParameterLength = (value: string): number => {
  const encoded = new URLSearchParams({ [MAIL_SEARCH_PARAMETER]: value }).toString();
  return encoded.length - `${MAIL_SEARCH_PARAMETER}=`.length;
};

export const serializeMailSearchState = (state: MailSearchState): SerializedMailSearchState => {
  const parsed = mailSearchStateSchema.safeParse(state);
  if (!parsed.success) return { ok: false, error: "The search contains an invalid condition." };

  const value = JSON.stringify(parsed.data);
  if (encodedParameterLength(value) > MAX_MAIL_SEARCH_PARAMETER_LENGTH) {
    return { ok: false, error: "The search is too large to keep in the mailbox URL. Remove or shorten a condition." };
  }
  return { ok: true, value };
};

export const parseMailSearchState = (url: URL): ParsedMailSearchState => {
  const value = url.searchParams.get(MAIL_SEARCH_PARAMETER);
  if (value === null) return { state: null, error: null };
  if (!value || encodedParameterLength(value) > MAX_MAIL_SEARCH_PARAMETER_LENGTH) {
    return { state: null, error: "The search link is invalid or too large." };
  }

  try {
    const parsed = mailSearchStateSchema.safeParse(JSON.parse(value));
    return parsed.success ? { state: parsed.data, error: null } : { state: null, error: "The search link contains an invalid condition." };
  } catch {
    return { state: null, error: "The search link is malformed." };
  }
};

export const parseMailQuickSearchScope = (url: URL): MailQuickSearchScope => {
  const raw = url.searchParams.get(MAIL_QUICK_SEARCH_SCOPE_PARAMETER);
  return MAIL_QUICK_SEARCH_SCOPES.find((scope) => scope === raw) ?? DEFAULT_MAIL_QUICK_SEARCH_SCOPE;
};

const quickSearchFields = (scope: MailQuickSearchScope): Extract<MailSearchExpression, { type: "text" }>["field"][] => {
  if (scope === "everything") return ["from", "recipients", "subject", "body", "attachment_name"];
  if (scope === "people") return ["participants"];
  if (scope === "sender") return ["from"];
  if (scope === "recipients") return ["recipients"];
  if (scope === "attachments") return ["attachment_name"];
  return [scope];
};

export const simpleMailSearchExpression = (
  query: string,
  scope: MailQuickSearchScope = DEFAULT_MAIL_QUICK_SEARCH_SCOPE,
): MailSearchExpression | null => {
  const normalized = query.trim();
  if (!normalized) return null;
  const expressions = quickSearchFields(scope).map((field) => ({
    type: "text" as const,
    field,
    query: normalized,
    match: "words" as const,
  }));
  return expressions.length === 1 ? expressions[0]! : { type: "or", expressions };
};

export const resolveMailSearchRoute = (url: URL): ResolvedMailSearchRoute => {
  const query = url.searchParams.get("q")?.trim() ?? "";
  const structured = parseMailSearchState(url);
  if (structured.error) return { query, expression: null, sort: "relevance", error: structured.error };
  if (structured.state) {
    return {
      query,
      expression: structured.state.expression,
      sort: structured.state.sort,
      error: null,
    };
  }

  const expression = simpleMailSearchExpression(query, parseMailQuickSearchScope(url));
  if (!expression) return { query, expression: null, sort: "relevance", error: null };
  const parsed = mailSearchExpressionSchema.safeParse(expression);
  return parsed.success
    ? { query, expression: parsed.data, sort: "relevance", error: null }
    : { query, expression: null, sort: "relevance", error: "The search query is invalid or too long." };
};
