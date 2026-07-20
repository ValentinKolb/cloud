import { type MailSearchExpression, type MailSearchState, mailSearchExpressionSchema, mailSearchStateSchema } from "./contracts";

export const MAIL_SEARCH_PARAMETER = "search";

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

export const simpleMailSearchExpression = (query: string): MailSearchExpression | null => {
  const normalized = query.trim();
  return normalized ? { type: "text", field: "any", query: normalized, match: "words" } : null;
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

  const expression = simpleMailSearchExpression(query);
  if (!expression) return { query, expression: null, sort: "relevance", error: null };
  const parsed = mailSearchExpressionSchema.safeParse(expression);
  return parsed.success
    ? { query, expression: parsed.data, sort: "relevance", error: null }
    : { query, expression: null, sort: "relevance", error: "The search query is invalid or too long." };
};
