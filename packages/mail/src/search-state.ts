import { type MailSearchExpression, type MailSearchState, mailSearchExpressionSchema, mailSearchStateSchema } from "./contracts";

export const MAIL_SEARCH_PARAMETER = "search";
export const MAIL_QUICK_SEARCH_FIELDS_PARAMETER = "qFields";
export const MAIL_QUICK_SEARCH_FIELDS = ["from", "recipients", "subject", "body", "attachment_name"] as const;
export type MailQuickSearchField = (typeof MAIL_QUICK_SEARCH_FIELDS)[number];
export const DEFAULT_MAIL_QUICK_SEARCH_FIELDS = ["from", "subject", "body"] as const satisfies readonly MailQuickSearchField[];

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

export const parseMailQuickSearchFields = (url: URL): MailQuickSearchField[] => {
  const raw = url.searchParams.get(MAIL_QUICK_SEARCH_FIELDS_PARAMETER);
  if (!raw) return [];
  const allowed = new Set<string>(MAIL_QUICK_SEARCH_FIELDS);
  return [...new Set(raw.split(",").filter((field): field is MailQuickSearchField => allowed.has(field)))];
};

export const simpleMailSearchExpression = (
  query: string,
  fields: readonly MailQuickSearchField[] = DEFAULT_MAIL_QUICK_SEARCH_FIELDS,
): MailSearchExpression | null => {
  const normalized = query.trim();
  if (!normalized) return null;
  const selectedFields = fields.length > 0 ? fields : DEFAULT_MAIL_QUICK_SEARCH_FIELDS;
  const expressions = selectedFields.map((field) => ({
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

  const fields = parseMailQuickSearchFields(url);
  const expression = simpleMailSearchExpression(query, fields.length > 0 ? fields : undefined);
  if (!expression) return { query, expression: null, sort: "relevance", error: null };
  const parsed = mailSearchExpressionSchema.safeParse(expression);
  return parsed.success
    ? { query, expression: parsed.data, sort: "relevance", error: null }
    : { query, expression: null, sort: "relevance", error: "The search query is invalid or too long." };
};
